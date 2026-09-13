/**
 * A SQLSTATE is five characters, and so are `EPERM`, `EPIPE`, `EBUSY`, `EBADF` and five more
 * Node errno codes — the shape alone would label a filesystem fault a database one and delete
 * the operator's only message. No PostgreSQL SQLSTATE class begins with `E` and every POSIX
 * errno name does, which separates them without asking the error for a second field.
 */
const SQL_STATE = /^[0-9A-DF-Z][0-9A-Z]{4}$/;

/**
 * One walk of the cause chain, answering both questions asked of it. `drizzle-orm` nests and the
 * depth is the library's business, so the chain is walked rather than indexed into.
 *
 * `code` is the first of any shape, which is what tells a refused connection from a rotated
 * password on a log line. `sqlState` is the first PostgreSQL could have sent: the one a `409`
 * may be decided on, and the one whose presence means a message is unsafe to keep.
 */
export function driverFault(
  error: unknown,
): { code?: string; sqlState?: string; constraint?: string } | undefined {
  let found: { code?: string; sqlState?: string; constraint?: string } | undefined;

  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };

    if (typeof code === 'string') {
      found ??= {};
      found.code ??= code;

      if (found.sqlState === undefined && SQL_STATE.test(code)) {
        found.sqlState = code;
        if (typeof constraint === 'string') found.constraint = constraint;
      }
    }
    current = current.cause;
  }

  return found;
}
