export type PricingOutcome =
  | { ok: true; basePriceCents: number; pricingRulesVersion: number }
  /** `rejectedBy` is null exactly when the vendor price itself was unusable. */
  | { ok: false; fault: 'row' | 'rules'; rejectedBy: string | null; reason: string };
