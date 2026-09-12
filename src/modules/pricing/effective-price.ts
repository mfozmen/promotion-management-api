/**
 * The calculators a promotion row names (design section 4, ADR-0004).
 *
 * `promotions.calculator` is the registry key and `promotions.params` its
 * configuration, so a new kind of discount needs no enum migration and no
 * change to any existing function — a new class, one registry line, and rows
 * naming it. Code holds the classes and the registry, never the policy: which
 * candidate wins is a rule, and the resolver (#36) runs the engine over the
 * discounts this module computed for each candidate.
 *
 * The registry is shared with the ingestion rules, so the percentage and fixed
 * arithmetic has one implementation (REVIEW.md 1.3). Ingestion still carries
 * its own copy on an unmerged branch; issue #45 moves it onto this registry.
 */
import { z } from 'zod';

export type PromotionStatus = 'draft' | 'active' | 'cancelled';

/** A promotion candidate, as the resolver hands it to the rule engine. */
export interface Promotion {
  status: PromotionStatus;
  startsAt: Date;
  /** Exclusive: the window is `[startsAt, endsAt)`. */
  endsAt: Date;
}

/**
 * A failure carries no price on purpose. Both variants used to carry one, and
 * a caller that read the field without checking `ok` would have published a
 * product free the moment its base price was unusable. The union forces the
 * branch instead: the storefront keeps the base price it already holds, the
 * ingestion path treats the same outcome as a `rules` fault and stops the job
 * rather than mispricing 500 000 rows, and either way the reason is logged.
 */
export type PricingOutcome =
  { ok: true; effectivePriceCents: number } | { ok: false; reason: string };

export interface DiscountCalculator {
  /** Names what is wrong with these parameters, or `null` when it can price them. */
  validate(params: unknown): string | null;
  calculate(baseCents: bigint, params: unknown): bigint;
}

const BASIS_POINTS_PER_UNIT = 10_000n;

/**
 * Everything a calculator must not get wrong, held once: parameters are
 * validated against the subclass's own schema before use, the arithmetic is
 * `bigint` so no intermediate product loses a cent, and the effective price is
 * clamped into `[0, baseCents]`. A subclass supplies only its schema and its
 * discount, so a new calculator cannot reintroduce a rounding or clamping bug
 * that was already fixed once — and cannot raise a price either, whatever the
 * row asks of it.
 */
abstract class ValidatedDiscount<P> implements DiscountCalculator {
  protected abstract readonly name: string;
  protected abstract readonly schema: z.ZodType<P>;
  /**
   * Whole minor units off the base price. Floored by construction: every
   * operand is a `bigint`, and `bigint` division truncates toward zero.
   */
  protected abstract discountCents(baseCents: bigint, params: P): bigint;

  validate(params: unknown): string | null {
    const parsed = this.schema.safeParse(params);
    return parsed.success
      ? null
      : `${this.name} rejected its parameters: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`;
  }

  calculate(baseCents: bigint, params: unknown): bigint {
    const parsed = this.schema.safeParse(params);
    // Callers validate first and report the reason; a calculator asked to
    // price parameters it rejects applies no discount rather than guessing.
    if (!parsed.success) return baseCents;

    // The schemas make a discount positive, so bounding it above by the base
    // price is the whole of `[0, baseCents]`: a discount larger than the price
    // is a free product, and none can push the price above the base.
    const discount = this.discountCents(baseCents, parsed.data);
    return baseCents - (discount > baseCents ? baseCents : discount);
  }
}

// Strict, because `promotions.params` is admin-authored data that no code
// review sees: `valueBasisPoint` beside a valid `valueBasisPoints` would
// otherwise be dropped in silence and the old discount would keep applying
// (REVIEW.md 8.1). A discount of zero is a promotion that does nothing, and
// one above 100 % can only ever mean a mistake; both are rejected rather than
// clamped, so the row gets fixed instead of quietly pricing at zero.
const percentageParams = z.strictObject({
  valueBasisPoints: z.number().int().positive().max(10_000),
});

class PercentageDiscount extends ValidatedDiscount<z.infer<typeof percentageParams>> {
  protected readonly name = 'PercentageDiscount';
  protected readonly schema = percentageParams;

  protected discountCents(baseCents: bigint, params: z.infer<typeof percentageParams>): bigint {
    // Floored on the discount, so a percentage rounds against the customer by
    // at most one minor unit rather than in their favour (REVIEW.md 1.4).
    return (baseCents * BigInt(params.valueBasisPoints)) / BASIS_POINTS_PER_UNIT;
  }
}

const fixedParams = z.strictObject({ valueCents: z.number().int().positive() });

class FixedDiscount extends ValidatedDiscount<z.infer<typeof fixedParams>> {
  protected readonly name = 'FixedDiscount';
  protected readonly schema = fixedParams;

  protected discountCents(_baseCents: bigint, params: z.infer<typeof fixedParams>): bigint {
    // Larger than the base price is a free product rather than a defect: the
    // clamp in the base class takes it to zero.
    return BigInt(params.valueCents);
  }
}

/**
 * The names a row may use, mapped to the classes that implement them: a
 * `promotions.calculator` on this path, and an ingestion rule's event on the
 * other, since both layers share this registry. Seeded with the two the case
 * asks for; a tiered or buy-one-get-one discount is a new class and one more
 * line here.
 */
const CALCULATORS: ReadonlyMap<string, new () => DiscountCalculator> = new Map<
  string,
  new () => DiscountCalculator
>([
  ['PercentageDiscount', PercentageDiscount],
  ['FixedDiscount', FixedDiscount],
]);

export const CalculatorFactory = {
  /**
   * `undefined` for a name the registry does not know: a defect in the row
   * that named it, which the caller reports rather than crashing on.
   */
  create(name: string): DiscountCalculator | undefined {
    const Calculator = CALCULATORS.get(name);
    return Calculator === undefined ? undefined : new Calculator();
  },
};

/**
 * The whole call site: resolve the calculator the promotion row names,
 * validate its `params` against that calculator's schema, run it. The resolver
 * calls this once per candidate, before the engine chooses between them — the
 * largest-discount default has to compare two discounts, and a rule cannot
 * compare candidates it never sees together.
 *
 * Never throws. `BigInt` raises a `RangeError` on a fractional, `NaN` or
 * infinite number, and one unusable product must not take down the batch
 * around it, so every failure is a returned outcome carrying a reason.
 */
export function applyPromotions(
  basePriceCents: number,
  calculatorName: string,
  params: unknown,
): PricingOutcome {
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
    return {
      ok: false,
      reason: `base price ${basePriceCents} is not a whole number of minor units in range`,
    };
  }

  // A blank or unknown name needs no separate guard: the registry is a `Map`,
  // so anything it never knew — including a row that lost its column — misses.
  const calculator = CalculatorFactory.create(calculatorName);
  if (calculator === undefined) {
    return { ok: false, reason: `unknown calculator "${calculatorName}"` };
  }

  const invalid = calculator.validate(params);
  if (invalid !== null) return { ok: false, reason: invalid };

  return {
    ok: true,
    effectivePriceCents: Number(calculator.calculate(BigInt(basePriceCents), params)),
  };
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
