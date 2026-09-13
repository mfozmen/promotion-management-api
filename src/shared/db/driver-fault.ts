/** A SQLSTATE is five characters; `ECONNREFUSED` on the same field is not one. */
const SQL_STATE = /^[0-9A-Z]{5}$/;

/**
 * The driver error inside whatever wrapped it. `drizzle-orm` nests, and the depth is the
 * library's business, so the chain is walked rather than indexed into.
 */
export function driverFault(error: unknown): { code: string; constraint?: string } | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };

    if (typeof code === 'string' && SQL_STATE.test(code)) {
      return typeof constraint === 'string' ? { code, constraint } : { code };
    }
    current = current.cause;
  }

  return undefined;
}
