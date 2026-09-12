/**
 * Ingestion pricing rules (design §7 step 3, ADR-0005).
 *
 * A vendor row plus the active rule set produces `base_price_cents` and the
 * `pricing_rules_version` that produced it. The wrapper takes the rules as
 * input instead of querying the database, so it stays pure and testable; the
 * 60 s caching policy the design asks for is `createRuleSetLoader`, which takes
 * the loader and the clock from its caller.
 *
 * Money is integer minor units and percentages are basis points throughout.
 * Every step is computed in `BigInt` and floored, so no intermediate product
 * loses a cent.
 */
import { Engine, type RuleProperties, type TopLevelCondition } from 'json-rules-engine';
import { z } from 'zod';

/** A row of the `pricing_rules` table (design §3). */
export type PricingRuleRow = {
  id: number;
  name: string;
  conditions: unknown;
  event: unknown;
  priority: number;
  active: boolean;
  updatedAt: Date;
};

/** The facts a rule may condition on: the vendor row as parsed by ingestion. */
export type VendorRowFacts = {
  category: string;
  vendorPriceCents: number;
  stockQuantity: number;
};

export type CompiledRuleSet = {
  engine: Engine;
  /** Max `updated_at` of the active rules, in epoch seconds; 0 when there are none. */
  pricingRulesVersion: number;
};

export type PricingOutcome =
  | { ok: true; basePriceCents: number; pricingRulesVersion: number }
  /**
   * `fault: 'row'` is this row's problem — count it, log it and carry on with
   * the batch; `rejectedBy` then names the rule that produced an impossible
   * price, or is `null` when the vendor price itself was unusable.
   * `fault: 'rules'` is the rule set's problem and every following row will
   * fail the same way, so the caller stops the job instead of rejecting
   * 500 000 rows one at a time.
   */
  | { ok: false; fault: 'row' | 'rules'; rejectedBy: string | null; reason: string };

const BPS = 10_000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

/** Exported so a future rules-write endpoint validates against this schema
 *  rather than growing a second copy of it. A percentage adjustment stops at
 *  -10 000 basis points, which already makes the price zero: anything beyond
 *  that can only ever produce a negative price, so it is rejected here rather
 *  than row by row. */
export const adjustmentEvent = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('adjustPercentBps'),
    params: z.strictObject({ value: z.number().int().min(-10_000) }),
  }),
  z.strictObject({
    type: z.literal('adjustCents'),
    params: z.strictObject({ value: z.number().int() }),
  }),
]);

type AdjustmentEvent = z.infer<typeof adjustmentEvent>;

/** Facts every rule is compiled against, so a rule naming a fact that is not a
 *  vendor row field fails at compile time rather than on every row. */
const PROBE_ROW: VendorRowFacts = { category: 'probe', vendorPriceCents: 0, stockQuantity: 0 };

/**
 * A copy of the conditions with every `priority` removed, used only for the
 * compile-time probe. The engine evaluates one condition priority set at a time
 * and stops at the first that decides the rule, so a typo'd operator sitting
 * behind a condition the probe row does not match would never be reached. With
 * the priorities gone every leaf is evaluated and every fault surfaces. Only
 * the probe sees this copy; the engine runs the untouched conditions.
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

/** Inactive rows are ignored; a malformed row is a descriptive error, never a
 *  silently skipped rule. */
export async function compileRules(rows: readonly PricingRuleRow[]): Promise<CompiledRuleSet> {
  // Sorted so the evaluation order is total: `pricing_rules.priority` defaults
  // to 0, and two rules sharing a priority would otherwise be evaluated in
  // parallel by the engine. The adjustments do not commute, so that would make
  // the price depend on insertion order. The stored id breaks the tie.
  const active = rows
    .filter((row) => row.active)
    .sort((a, b) => b.priority - a.priority || a.id - b.id);
  const engine = new Engine();

  for (const [rank, row] of active.entries()) {
    const where = `pricing rule ${row.id} ("${row.name}")`;
    const event = adjustmentEvent.safeParse(row.event);
    if (!event.success) {
      throw new Error(`${where} has a malformed event: ${event.error.issues[0]?.message}`);
    }
    const properties: RuleProperties = {
      // The engine reports a fired rule by name only, and names are not unique
      // in the design, so the id travels inside the name and reaches `rejectedBy`.
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
      // file while the job still reported success. Probe it here instead.
      await new Engine([
        { ...properties, conditions: withoutPriorities(row.conditions) as TopLevelCondition },
      ]).run(PROBE_ROW);
    } catch (error) {
      throw new Error(`${where} cannot be compiled: ${(error as Error).message}`);
    }
  }

  const newest = active.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0);
  return { engine, pricingRulesVersion: Math.floor(newest / 1000) };
}

const applied = (cents: bigint, event: AdjustmentEvent): bigint =>
  event.type === 'adjustCents'
    ? cents + BigInt(event.params.value)
    : // Floored, so a markup never charges the extra cent: BigInt division
      // truncates towards zero, and `cents` is proven non-negative by the
      // guard below before it is ever used as an operand again.
      (cents * (BPS + BigInt(event.params.value))) / BPS;

/** The row schema in the chunk processor validates this too, but a wrapper
 *  that promises never to throw cannot take that on trust: BigInt() throws on
 *  a fractional or NaN price, and a missing or null fact makes the engine
 *  either throw or, worse, evaluate the condition false and skip the rule
 *  with no trace in the result. */
const vendorRowFacts = z.object({
  category: z.string(),
  vendorPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  stockQuantity: z.number().int().min(0),
});

/** `Engine.run` keeps one status per engine, so a run that finishes while
 *  another is in flight makes the other skip its remaining rules and return a
 *  short result with no error. Runs on one engine are queued instead; a batch
 *  prices its rows one at a time either way. */
const runQueue = new WeakMap<Engine, Promise<unknown>>();
const runSerialised = (engine: Engine, facts: VendorRowFacts) => {
  const next = (runQueue.get(engine) ?? Promise.resolve()).then(() => engine.run(facts));
  runQueue.set(
    engine,
    next.catch(() => undefined),
  );
  return next;
};

/** A bad row is a returned rejection, never a thrown exception, so one row
 *  cannot abort the batch around it. */
export async function priceRow(
  rules: CompiledRuleSet,
  row: VendorRowFacts,
): Promise<PricingOutcome> {
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
    ({ results } = await runSerialised(rules.engine, facts.data));
  } catch (error) {
    return { ok: false, fault: 'rules', rejectedBy: null, reason: (error as Error).message };
  }

  // Results arrive in rank order: compileRules gives every rule its own
  // priority and the engine evaluates one priority set at a time, in order.
  let cents = BigInt(facts.data.vendorPriceCents);
  for (const result of results) {
    const next = applied(cents, result.event as AdjustmentEvent);
    if (next < 0n) {
      return {
        ok: false,
        fault: 'row',
        rejectedBy: result.name,
        reason: `price ${next} is below zero`,
      };
    }
    if (next > MAX_CENTS) {
      return {
        ok: false,
        fault: 'row',
        rejectedBy: result.name,
        reason: `price ${next} is above the largest exact cent value ${MAX_CENTS}`,
      };
    }
    cents = next;
  }

  return {
    ok: true,
    basePriceCents: Number(cents),
    pricingRulesVersion: rules.pricingRulesVersion,
  };
}

/** The clock is injected so the 60 s policy (design §7 step 3) is testable
 *  without sleeping, and the in-flight promise is cached so a batch starting
 *  cold issues one query, not one per row. */
export function createRuleSetLoader(options: {
  load: () => Promise<readonly PricingRuleRow[]>;
  now: () => number;
  ttlMs?: number;
}): () => Promise<CompiledRuleSet> {
  const ttlMs = options.ttlMs ?? 60_000;
  let cached: { expiresAt: number; rules: Promise<CompiledRuleSet> } | undefined;

  return () => {
    if (cached === undefined || options.now() >= cached.expiresAt) {
      const rules = options.load().then(compileRules);
      cached = { expiresAt: options.now() + ttlMs, rules };
      // A failed load must not be served for the next 60 s. A rejection that
      // lands after a newer entry was installed clears that entry too; the
      // cost is one extra load, never a wrong price.
      rules.catch(() => {
        cached = undefined;
      });
    }
    return cached.rules;
  };
}
