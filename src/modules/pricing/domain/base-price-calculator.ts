import { Engine, type RuleProperties, type TopLevelCondition } from 'json-rules-engine';

import type { AdjustmentEvent } from './dto/adjustment-event.js';
import { adjustmentEvent } from './dto/adjustment-event.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import type { PricingRuleRow } from './dto/pricing-rule-row.js';
import { type VendorRowFacts, vendorRowFacts } from './dto/vendor-row-facts.js';

const BPS = 10_000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const PROBE_ROW: VendorRowFacts = { category: 'probe', vendorPriceCents: 0, stockQuantity: 0 };

/**
 * The active ingestion rules, compiled once and priced one row at a time. Runs are
 * serialised here because the rule engine keeps per-run state on itself, so holding the
 * compiled rules and the queue apart would make the guarantee a caller's to keep. ADR-0005.
 */
export class BasePriceCalculator {
  private queue: Promise<unknown> = Promise.resolve();
  private spentBy: Error | undefined;

  /** `compile` is the way in; this is for a test that needs an engine it prepared itself. */
  constructor(
    private readonly engine: Engine,
    readonly ruleIds: readonly number[],
    /** Epoch ms, the unit `products.pricing_rules_version` stores. */
    readonly pricingRulesVersion: number,
  ) {}

  static async fromRules(rows: readonly PricingRuleRow[]): Promise<BasePriceCalculator> {
    const active = BasePriceCalculator.activeIngestionRules(rows);
    if (active.length === 0) {
      throw new Error('no active ingestion pricing rules (none seeded, or every rule deactivated)');
    }

    const engine = new Engine();
    for (const [rank, row] of active.entries()) {
      engine.addRule(await BasePriceCalculator.toRule(row, active.length - rank));
    }

    return new BasePriceCalculator(
      engine,
      active.map((row) => row.id),
      BasePriceCalculator.newestVersion(active),
    );
  }

  private static activeIngestionRules(rows: readonly PricingRuleRow[]): PricingRuleRow[] {
    return rows
      .filter((row) => row.active && row.type === 'ingestion')
      .sort((a, b) => b.priority - a.priority || a.id - b.id);
  }

  private static async toRule(row: PricingRuleRow, priority: number): Promise<RuleProperties> {
    const where = `pricing rule ${row.id} ("${row.name}")`;
    const properties: RuleProperties = {
      // A fired rule is reported by name only, so the id rides in the name to reach `rejectedBy`.
      name: where,
      priority,
      conditions: row.conditions as TopLevelCondition,
      event: BasePriceCalculator.parseEvent(row, where),
    };

    BasePriceCalculator.rejectEmptyGroup(row, where);
    await BasePriceCalculator.probe(properties, row, where);
    return properties;
  }

  private static parseEvent(row: PricingRuleRow, where: string): AdjustmentEvent {
    const event = adjustmentEvent.safeParse(row.event);
    if (!event.success) {
      throw new Error(`${where} has a malformed event: ${event.error.issues[0]?.message}`);
    }
    return event.data;
  }

  private static rejectEmptyGroup(row: PricingRuleRow, where: string): void {
    if (BasePriceCalculator.hasEmptyGroup(row.conditions)) {
      throw new Error(`${where} has an empty all or any, which matches every row or none`);
    }
  }

  private static async probe(
    properties: RuleProperties,
    row: PricingRuleRow,
    where: string,
  ): Promise<void> {
    try {
      await new Engine([
        {
          ...properties,
          conditions: BasePriceCalculator.withoutPriorities(row.conditions) as TopLevelCondition,
        },
      ]).run(PROBE_ROW);
    } catch (error) {
      throw new Error(`${where} cannot be compiled: ${(error as Error).message}`);
    }
  }

  private static newestVersion(rows: readonly PricingRuleRow[]): number {
    return rows.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0);
  }

  /** A bad row is a returned rejection, never a throw: one row cannot abort the batch. */
  async calculate(row: VendorRowFacts): Promise<PricingOutcome> {
    const facts = vendorRowFacts.safeParse(row);
    if (!facts.success) {
      const [issue] = facts.error.issues;
      return {
        ok: false,
        fault: 'row',
        rejectedBy: null,
        reason: `${issue?.path.join('.')}: ${issue?.message}`,
      };
    }

    let results;
    try {
      ({ results } = await this.run(facts.data));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'rules', rejectedBy: null, reason };
    }

    let cents = BigInt(facts.data.vendorPriceCents);
    for (const result of results) {
      const next = this.apply(cents, result.event as AdjustmentEvent);
      const outOfRange = BasePriceCalculator.outOfRange(next, result.name as string);
      if (outOfRange !== undefined) return outOfRange;
      cents = next;
    }

    return {
      ok: true,
      basePriceCents: Number(cents),
      pricingRulesVersion: this.pricingRulesVersion,
    };
  }

  private static outOfRange(cents: bigint, rejectedBy: string): PricingOutcome | undefined {
    if (cents < 0n) {
      return { ok: false, fault: 'row', rejectedBy, reason: `price ${cents} is below zero` };
    }
    if (cents > MAX_CENTS) {
      return {
        ok: false,
        fault: 'row',
        rejectedBy,
        reason: `price ${cents} is above the largest exact cent value ${MAX_CENTS}`,
      };
    }
    return undefined;
  }

  private run(facts: VendorRowFacts) {
    // Checked inside the continuation too: a row queued before the failure lands would
    // otherwise run on a spent engine.
    const run = this.queue.then(() =>
      this.spentBy ? Promise.reject(this.spentBy) : this.engine.run(facts),
    );
    this.queue = run.catch((error: unknown) => {
      this.spentBy = error instanceof Error ? error : new Error(String(error));
    });
    return run;
  }

  private apply(cents: bigint, event: AdjustmentEvent): bigint {
    return event.type === 'adjustCents'
      ? cents + BigInt(event.params.value)
      : // Floored: BigInt division truncates towards zero and `cents` is non-negative here.
        (cents * (BPS + BigInt(event.params.value))) / BPS;
  }

  /** Probe only: the engine stops at the first priority set that decides a rule, so a broken
   *  operator behind an unmatched condition is never reached. */
  private static withoutPriorities(node: unknown): unknown {
    if (Array.isArray(node))
      return node.map((child) => BasePriceCalculator.withoutPriorities(child));
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'priority')
        .map(([key, value]) => [key, BasePriceCalculator.withoutPriorities(value)]),
    );
  }

  /** Both `{all:[]}` and `{any:[]}` are well-formed and fire on every row. ADR-0005. */
  private static hasEmptyGroup(node: unknown): boolean {
    if (Array.isArray(node)) return node.some((child) => BasePriceCalculator.hasEmptyGroup(child));
    if (node === null || typeof node !== 'object') return false;
    const groups = Object.entries(node).filter(([key]) => key === 'all' || key === 'any');
    if (groups.some(([, value]) => Array.isArray(value) && value.length === 0)) return true;
    return Object.values(node).some((value) => BasePriceCalculator.hasEmptyGroup(value));
  }
}
