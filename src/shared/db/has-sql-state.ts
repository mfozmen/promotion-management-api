/** The chain is walked rather than indexed into: `drizzle-orm` wraps the
 *  driver error and the nesting depth is the library's business. */
export function hasSqlState(error: unknown, state: string): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === state) return true;
    current = current.cause;
  }

  return false;
}
