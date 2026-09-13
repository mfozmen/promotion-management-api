export type PricingOutcome =
  { ok: true; effectivePriceCents: number } | { ok: false; reason: string };
