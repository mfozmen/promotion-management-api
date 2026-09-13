/** PostgreSQL `exclusion_violation`, raised by the two GiST constraints on `promotions`. */
const EXCLUSION_VIOLATION = '23P01';

/**
 * Whether an error raised by a write is an exclusion-constraint violation.
 *
 * The cause chain is walked rather than indexed into, for the reason given in
 * `unique-violation.ts`: the nesting depth is the ORM's business.
 */
export function isExclusionViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === EXCLUSION_VIOLATION) return true;
    current = current.cause;
  }
  return false;
}
