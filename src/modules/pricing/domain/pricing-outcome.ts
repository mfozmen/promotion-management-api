export type PricingOutcome =
  | { ok: true; basePriceCents: number; pricingRulesVersion: number }
  /**
  /** `rejectedBy` is null exactly when the vendor price itself was unusable.
   *  Which fault stops the job is ADR-0005. */
  | { ok: false; fault: 'row' | 'rules'; rejectedBy: string | null; reason: string };
