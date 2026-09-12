/**
 * The instruction set the promotion rules are written in (design section 4,
 * ADR-0004).
 *
 * The vocabulary is shared with the ingestion rules deliberately: the
 * percentage and cents arithmetic is to have one implementation
 * (REVIEW.md 1.3). Ingestion still carries its own copy on an unmerged
 * branch; issue #45 moves it onto this registry.
 */

export type PromotionStatus = 'draft' | 'active' | 'cancelled';

/** A promotion candidate, as the resolver hands it to the rule engine. */
export interface Promotion {
  status: PromotionStatus;
  startsAt: Date;
  /** Exclusive: the window is `[startsAt, endsAt)`. */
  endsAt: Date;
}

/** The event a matching rule carries: what to do to the price, and by how much. */
export interface AdjustmentEvent {
  type: string;
  params: { value: number };
}

/** What a rule row can actually contain, before anything has validated it. */
type UncheckedEvent = { type: string; params?: { value?: unknown } | null };

/**
 * Both outcomes carry a price, so a caller always has something safe to write:
 * on failure it is the untouched base price, or zero when the base price is
 * itself the thing that is unusable. `ok: false` is the caller's cue
 * to log and count — a bad event must not crash a 50 000-product recompute,
 * and must not pass for a priced product either.
 */
export type PricingOutcome =
  | { ok: true; effectivePriceCents: number }
  | { ok: false; effectivePriceCents: number; reason: string };

const BASIS_POINTS_PER_UNIT = 10_000n;

/**
 * One arithmetic step, in whole minor units. Every caller — `applyPromotions`
 * here, the ingestion wrapper once issue #45 lands — owes a strategy a non-negative
 * `cents` and a `value` that passed `validate`, which is what lets `apply`
 * skip the `BigInt` guards and treat truncating division as a floor.
 */
export interface Adjustment {
  /** Names the parameter it cannot price, or `null` when it can. */
  validate(value: number): string | null;
  apply(cents: bigint, params: { value: number }): bigint;
}

/**
 * `value` is a signed basis-point adjustment: `-2500` takes a quarter off,
 * `+1500` is the ingestion markup.
 *
 * The adjustment itself is floored, not the price, so a discount rounds
 * against the customer by at most one minor unit (ADR-0004, REVIEW.md 1.4).
 * `bigint` division truncates toward zero, which is that floor for a discount;
 * for a markup it agrees exactly with `cents * (10000 + value) / 10000`, so
 * the ingestion rules keep the prices they were reviewed against.
 */
class PercentBpsAdjustment implements Adjustment {
  validate(value: number): string | null {
    // Below -10 000 basis points the adjustment exceeds the whole price, which
    // is a price below zero rather than a free product.
    return value < -10_000 ? `percentage adjustment ${value} is below -10000 basis points` : null;
  }

  apply(cents: bigint, params: { value: number }): bigint {
    return cents + (cents * BigInt(params.value)) / BASIS_POINTS_PER_UNIT;
  }
}

/** `value` is a signed amount of minor units: `-500` takes five currency units off. */
class CentsAdjustment implements Adjustment {
  validate(): string | null {
    return null;
  }

  apply(cents: bigint, params: { value: number }): bigint {
    return cents + BigInt(params.value);
  }
}

const ADJUSTMENTS: ReadonlyMap<string, Adjustment> = new Map<string, Adjustment>([
  ['adjustPercentBps', new PercentBpsAdjustment()],
  ['adjustCents', new CentsAdjustment()],
]);

/** The lookup both layers share, so neither grows its own copy of the arithmetic. */
export function adjustmentFor(type: string): Adjustment | undefined {
  return ADJUSTMENTS.get(type);
}

/**
 * Applies the winning rule's event to a base price. `event` is `null` when no
 * rule fired, and the base price stands.
 *
 * Every rejection returns the base price with a reason instead of throwing:
 * `BigInt` raises a `RangeError` on a fractional, `NaN` or infinite number,
 * and one unusable product must not take down the batch around it.
 *
 * Only this path rejects a price-raising adjustment. Ingestion calls the
 * strategies directly, where a markup is the whole point.
 */
export function applyPromotions(
  basePriceCents: number,
  event: UncheckedEvent | null,
): PricingOutcome {
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
    return {
      ok: false,
      effectivePriceCents: 0,
      reason: `base price ${basePriceCents} is not a whole number of minor units in range`,
    };
  }
  if (event === null) return { ok: true, effectivePriceCents: basePriceCents };

  const rejected = (reason: string): PricingOutcome => ({
    ok: false,
    effectivePriceCents: basePriceCents,
    reason,
  });

  // An event naming a type no strategy implements is a defect in the rule row,
  // not in the product: skipped with the base price, never a crash.
  const adjustment = adjustmentFor(event.type);
  if (adjustment === undefined) return rejected(`unknown adjustment type "${event.type}"`);

  // The event is a database row, not a TypeScript value: a rule written
  // without `params` type-checks nowhere and reaches here all the same.
  const value: unknown = event.params?.value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    // Quoted when it is a string, or `"-2500"` and `-2500` would produce the
    // same message and the second would read as a contradiction.
    const shown = typeof value === 'string' ? `"${value}"` : String(value);
    return rejected(`adjustment value ${shown} is not a whole number in range`);
  }
  const invalid = adjustment.validate(value);
  if (invalid !== null) return rejected(invalid);
  // A markup is legitimate for ingestion and a rule-authoring defect here, and
  // the two are told apart only by which layer ran the rule — so it is
  // reported rather than quietly clamped, or a stray `+1500` copied from the
  // seeded ingestion rules would look exactly like no promotion at all. On the
  // sign, not on the result: a markup too small to move a cheap product's
  // price is the same defect and must not slip through rounding.
  if (value > 0) return rejected(`adjustment ${value} would raise the price above the base`);

  const adjusted = adjustment.apply(BigInt(basePriceCents), { value });

  // A discount larger than the whole price is not a defect, it is a free
  // product: clamped, never negative (REVIEW.md 1.5).
  return { ok: true, effectivePriceCents: Number(adjusted < 0n ? 0n : adjusted) };
}

/**
 * Whether a candidate is live at `now`. A fact for the rule engine, not a
 * decision: which live candidate wins is a rule, not code.
 */
export function isActive(promotion: Promotion, now: Date): boolean {
  const nowMs = now.getTime();

  return (
    promotion.status === 'active' &&
    promotion.startsAt.getTime() <= nowMs &&
    nowMs < promotion.endsAt.getTime()
  );
}
