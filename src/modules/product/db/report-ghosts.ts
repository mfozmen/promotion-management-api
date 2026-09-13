import { logger } from '../../../shared/logger.js';

/** Long enough that a rebuild writes a handful of lines rather than one per
 *  request, short enough that the first line arrives while an operator is
 *  still looking at the incident. */
const WINDOW_MS = 10_000;

let openedAt = 0;
let requests = 0;
let missing = 0;

/** Ghost members are ordinary during a rebuild, and a rebuild of a 50 000-product
 *  category is exactly when the storefront is hottest, so a line per request is
 *  thousands per second into pino's unbounded destination. The first request in
 *  a window reports itself and what the previous window swallowed. */
export function reportGhosts(key: string, absent: number): void {
  const now = Date.now();
  requests += 1;
  missing += absent;

  if (now - openedAt < WINDOW_MS) return;

  openedAt = now;
  logger.warn({ key, requests, missing }, 'read model lists ids whose hashes are gone');
  requests = 0;
  missing = 0;
}
