import { logger } from '../../../shared/logger.js';

/** Long enough that a rebuild writes a handful of lines rather than one per
 *  request, short enough that the first line arrives while an operator is
 *  still looking at the incident. */
const WINDOW_MS = 10_000;

interface Window {
  openedAt: number;
  requests: number;
  missing: number;
}

/** Keyed by index, because two categories rebuilt at once would otherwise be
 *  reported as one: the line would name whichever key happened to close the
 *  window and an operator would scope the rebuild at the wrong category. One
 *  entry per index the storefront serves, so it is bounded by the catalogue's
 *  categories rather than by traffic. */
const windows = new Map<string, Window>();

/** Ghost members are ordinary during a rebuild, and a rebuild of a 50 000-product
 *  category is exactly when the storefront is hottest, so a line per request is
 *  thousands per second into pino's unbounded destination. The first request in
 *  a window reports itself and what the previous window swallowed. */
export function reportGhosts(key: string, absent: number): void {
  const now = Date.now();
  const open = windows.get(key) ?? { openedAt: 0, requests: 0, missing: 0 };
  open.requests += 1;
  open.missing += absent;

  if (now - open.openedAt < WINDOW_MS) {
    windows.set(key, open);

    return;
  }

  logger.warn(
    { key, requests: open.requests, missing: open.missing },
    'read model lists ids whose hashes are gone',
  );
  windows.set(key, { openedAt: now, requests: 0, missing: 0 });
}
