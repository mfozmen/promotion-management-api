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
