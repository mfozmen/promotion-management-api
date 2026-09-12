import { Engine, type RuleProperties, type TopLevelCondition } from 'json-rules-engine';

import { adjustmentEvent } from './adjustment-event.js';
import type { CompiledRuleSet } from './compiled-rule-set.js';
import type { PricingRuleRow } from './pricing-rule-row.js';
import type { VendorRowFacts } from './vendor-row-facts.js';

/** Every rule is compiled against these facts, so a rule naming a fact that is
 *  not a vendor row field fails here rather than on every row. */
const PROBE_ROW: VendorRowFacts = { category: 'probe', vendorPriceCents: 0, stockQuantity: 0 };

/**
 * The conditions with every `priority` removed, for the compile-time probe
 * only: the engine stops at the first priority set that decides the rule, so a
 * typo’d operator behind an unmatched condition would never be reached. The
 * engine runs the untouched conditions.
 */
const withoutPriorities = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutPriorities);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'priority')
      .map(([key, value]) => [key, withoutPriorities(value)]),
  );
};

/** A malformed row is a descriptive error, never a silently skipped rule. */
export async function compileRules(rows: readonly PricingRuleRow[]): Promise<CompiledRuleSet> {
  // Total order: the adjustments do not commute, and two rules sharing a
  // priority would otherwise evaluate in parallel. The stored id breaks the tie.
  const active = rows
    .filter((row) => row.active && row.type === 'ingestion')
    .sort((a, b) => b.priority - a.priority || a.id - b.id);
  // An empty set would price the whole catalogue at vendor cost and report the
  // job completed (ADR-0005).
  if (active.length === 0) {
    throw new Error('no active ingestion pricing rules (none seeded, or every rule deactivated)');
  }
  const engine = new Engine();

  for (const [rank, row] of active.entries()) {
    const where = `pricing rule ${row.id} ("${row.name}")`;
    const event = adjustmentEvent.safeParse(row.event);
    if (!event.success) {
      throw new Error(`${where} has a malformed event: ${event.error.issues[0]?.message}`);
    }
    const properties: RuleProperties = {
      // The engine reports a fired rule by name only, so the id travels inside
      // the name and reaches `rejectedBy` as the row a reader can look up.
      name: where,
      // The rank, not the stored priority: one rule per engine priority set
      // makes the evaluation order total rather than "highest set first".
      priority: active.length - rank,
      conditions: row.conditions as TopLevelCondition,
      event: event.data,
    };
    try {
      engine.addRule(properties);
      // An unknown operator or an unknown fact only surfaces when the engine
      // runs, so a rule broken that way would reject every row of a 500 000-row
      // file while the job still reported success.
      await new Engine([
        { ...properties, conditions: withoutPriorities(row.conditions) as TopLevelCondition },
      ]).run(PROBE_ROW);
    } catch (error) {
      throw new Error(`${where} cannot be compiled: ${(error as Error).message}`);
    }
  }

  const newest = active.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0);
  return {
    engine,
    ruleIds: active.map((row) => row.id),
    pricingRulesVersion: newest,
  };
}
