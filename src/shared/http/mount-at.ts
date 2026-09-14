import type { Express, Router } from 'express';

/** Express 5 keeps no readable mount path: `layer.path` is filled during a match
 *  and the matchers are closures over a regexp, so it cannot be recovered later. */
export function mountAt(parent: Express | Router, path: string, router: Router): void {
  (router as unknown as Record<symbol, string>)[Symbol.for('pma.mountedAt')] = path;
  (parent as Router).use(path, router);
}
