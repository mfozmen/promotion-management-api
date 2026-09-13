import type { AdjustmentEvent } from './dto/adjustment-event.js';
import type { CompiledRuleSet } from './dto/compiled-rule-set.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import { type VendorRowFacts, vendorRowFacts } from './dto/vendor-row-facts.js';

const BPS = 10_000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

/** One pricer per rule set: the engine allows one run at a time, and two overlapping runs
 *  clobber each other. ADR-0005. */
export class RowPricer {
  private queue: Promise<unknown> = Promise.resolve();
  private spentBy: Error | undefined;

  constructor(private readonly rules: CompiledRuleSet) {}

  /** A bad row is a returned rejection, never a throw: one row cannot abort the batch. */
  async price(row: VendorRowFacts): Promise<PricingOutcome> {
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
      ({ results } = await this.runSerialised(facts.data));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'rules', rejectedBy: null, reason };
    }

    let cents = BigInt(facts.data.vendorPriceCents);
    for (const result of results) {
      const next = this.applied(cents, result.event as AdjustmentEvent);
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
      pricingRulesVersion: this.rules.pricingRulesVersion,
    };
  }

  private runSerialised(facts: VendorRowFacts) {
    // Checked inside the continuation too: a row queued before the failure lands would
    // otherwise run on a spent engine.
    const run = this.queue.then(() =>
      this.spentBy ? Promise.reject(this.spentBy) : this.rules.engine.run(facts),
    );
    this.queue = run.catch((error: unknown) => {
      this.spentBy = error instanceof Error ? error : new Error(String(error));
    });
    return run;
  }

  private applied(cents: bigint, event: AdjustmentEvent): bigint {
    return event.type === 'adjustCents'
      ? cents + BigInt(event.params.value)
      : // Floored: BigInt division truncates towards zero and `cents` is non-negative here.
        (cents * (BPS + BigInt(event.params.value))) / BPS;
  }
}
