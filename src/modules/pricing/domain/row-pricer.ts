import type { AdjustmentEvent } from './dto/adjustment-event.js';
import type { CompiledRuleSet } from './compiled-rule-set.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import { type VendorRowFacts, vendorRowFacts } from './dto/vendor-row-facts.js';

const BPS = 10_000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export class RowPricer {
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
      ({ results } = await this.rules.run(facts.data));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'rules', rejectedBy: null, reason };
    }

    let cents = BigInt(facts.data.vendorPriceCents);
    for (const result of results) {
      const next = this.apply(cents, result.event as AdjustmentEvent);
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

  private apply(cents: bigint, event: AdjustmentEvent): bigint {
    return event.type === 'adjustCents'
      ? cents + BigInt(event.params.value)
      : // Floored: BigInt division truncates towards zero and `cents` is non-negative here.
        (cents * (BPS + BigInt(event.params.value))) / BPS;
  }
}
