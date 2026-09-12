/** PostgreSQL `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether an error raised by a write is a unique-index violation.
 *
 * The chain is walked rather than indexed into: `drizzle-orm` wraps the driver
 * error in a `DrizzleQueryError` and the nesting depth is the library's
 * business, not ours. Writing `error.cause.code` against an imagined shape is
 * what cost PR #30 two review rounds, twice over (REVIEW.md 8b.5).
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = current.cause;
  }
  return false;
}
