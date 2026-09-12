import type { Engine } from 'json-rules-engine';

import type { AdjustmentEvent } from './adjustment-event.js';
import type { CompiledRuleSet } from './compiled-rule-set.js';
import type { PricingOutcome } from './pricing-outcome.js';
import { type VendorRowFacts, vendorRowFacts } from './vendor-row-facts.js';

const BPS = 10_000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

const applied = (cents: bigint, event: AdjustmentEvent): bigint =>
  event.type === 'adjustCents'
    ? cents + BigInt(event.params.value)
    : // Floored, so a markup never charges the extra cent: BigInt division
      // truncates towards zero, and `cents` is proven non-negative by the
      // guard below before it is ever used as an operand again.
      (cents * (BPS + BigInt(event.params.value))) / BPS;

/** `Engine.run` keeps one status per engine, so a run finishing while another
 *  is in flight makes the other skip its remaining rules and return a short
 *  result with no error. Runs on one engine are queued instead.
 *
 *  A failed run marks the engine finished under the next run's feet, so the
 *  engine is spent once a run fails. That costs nothing, because a
 *  `fault: 'rules'` already tells the caller to stop the job. */
const runState = new WeakMap<Engine, { queue: Promise<unknown>; spentBy?: Error }>();

const runSerialised = (engine: Engine, facts: VendorRowFacts) => {
  const state = runState.get(engine) ?? { queue: Promise.resolve() };
  runState.set(engine, state);
  // Checked inside the continuation, not only here: a row queued before the
  // failure lands would otherwise run on the spent engine and come back short.
  const run = state.queue.then(() =>
    state.spentBy ? Promise.reject(state.spentBy) : engine.run(facts),
  );
  state.queue = run.catch((error: unknown) => {
    // Normalised, because a rejection that is not an Error would leave the
    // engine unspent and throw out of a function that promises not to.
    state.spentBy = error instanceof Error ? error : new Error(String(error));
  });
  return run;
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
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, fault: 'rules', rejectedBy: null, reason };
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
