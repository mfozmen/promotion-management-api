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

/** Keyed by index so two rebuilds are not reported as one (ADR-0006).
 *
 *  Bounded by the catalogue's categories only because an absent key returns no
 *  members, so an invented `?category=` never reaches here. Reporting on an
 *  empty page would make this map unbounded on an unauthenticated route. */
const windows = new Map<string, Window>();

/** One line per window rather than per request, because a rebuild is when the
 *  storefront is hottest (ADR-0006). The first request in a window reports
 *  itself and what the previous window swallowed. */
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
    // The interval, so `requests` has a denominator rather than being a count
    // since some moment the reader has to guess at.
    { key, requests: open.requests, missing: open.missing, windowMs: WINDOW_MS },
    'read model lists ids whose hashes are gone',
  );
  windows.set(key, { openedAt: now, requests: 0, missing: 0 });
}
