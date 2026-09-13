import type { Engine } from 'json-rules-engine';

import type { AdjustmentEvent } from './dto/adjustment-event.js';
import type { CompiledRuleSet } from './dto/compiled-rule-set.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import { type VendorRowFacts, vendorRowFacts } from './dto/vendor-row-facts.js';

const BPS = 10_000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

const applied = (cents: bigint, event: AdjustmentEvent): bigint =>
  event.type === 'adjustCents'
    ? cents + BigInt(event.params.value)
    : // Floored: BigInt division truncates towards zero and `cents` is non-negative here.
      (cents * (BPS + BigInt(event.params.value))) / BPS;

/** One engine, one run at a time: concurrent runs clobber each other. ADR-0005. */
const runState = new WeakMap<Engine, { queue: Promise<unknown>; spentBy?: Error }>();

const runSerialised = (engine: Engine, facts: VendorRowFacts) => {
  const state = runState.get(engine) ?? { queue: Promise.resolve() };
  runState.set(engine, state);
  // Inside the continuation too: a row queued before the failure would run on a spent engine.
  const run = state.queue.then(() =>
    state.spentBy ? Promise.reject(state.spentBy) : engine.run(facts),
  );
  state.queue = run.catch((error: unknown) => {
    state.spentBy = error instanceof Error ? error : new Error(String(error));
  });
  return run;
};

/** A bad row is a returned rejection, never a throw: one row cannot abort the batch. */
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
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, fault: 'rules', rejectedBy: null, reason };
  }

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
