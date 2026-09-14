import type { AppDependencies } from '@src/app-dependencies.js';
import { logger } from '@src/shared/logger.js';

/** Every dependency is required, and most cases exercise one route group. The
 *  members a case does not reach are never called, so a stub is honest. */
export function appDeps(over: Partial<AppDependencies> = {}): AppDependencies {
  return {
    logger,
    // `/metrics` asks both stores on every scrape (`dependency_up`), so these two are reached by
    // every case that renders the app, not only by the ones that query.
    db: { execute: () => Promise.resolve() },
    queue: { publish: () => Promise.resolve() },
    boardQueues: [],
    scheduler: {},
    products: { ping: () => Promise.resolve() },
    ...over,
  } as unknown as AppDependencies;
}
