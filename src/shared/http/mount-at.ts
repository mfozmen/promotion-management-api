import type { Express, Router } from 'express';

/**
 * Express 5 keeps no readable mount path: `layer.path` is filled during a match
 * and the matchers are closures over a regexp, so `/api/products` cannot be
 * recovered from a mounted router afterwards. Stamping it as it is mounted
 * leaves the string written exactly once, in the call that uses it. The reader
 * is `route-inventory.ts`, which looks the same symbol up out of the global
 * registry rather than importing it.
 */
export function mountAt(parent: Express | Router, path: string, router: Router): void {
  (router as unknown as Record<symbol, string>)[Symbol.for('pma.mountedAt')] = path;
  (parent as Router).use(path, router);
}
