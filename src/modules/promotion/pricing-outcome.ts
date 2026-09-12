/** A failure carries no price, so a caller cannot publish one by mistake. */
export type PricingOutcome =
  { ok: true; effectivePriceCents: number } | { ok: false; reason: string };
