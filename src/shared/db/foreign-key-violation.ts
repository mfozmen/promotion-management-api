/** PostgreSQL `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Whether an error raised by a write is a foreign-key violation.
 *
 * The cause chain is walked rather than indexed into, for the reason given in
 * `unique-violation.ts`: the nesting depth is the ORM's business.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return true;
    current = current.cause;
  }
  return false;
}
