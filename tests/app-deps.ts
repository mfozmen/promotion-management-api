import type { AppDependencies } from '@src/app-dependencies.js';
import { logger } from '@src/shared/logger.js';

/** Every dependency is required, and most cases exercise one route group. The
 *  members a case does not reach are never called, so a stub is honest. */
export function appDeps(over: Partial<AppDependencies> = {}): AppDependencies {
  return {
    logger,
    db: {},
    queue: { publish: () => Promise.resolve() },
    boardQueues: [],
    scheduler: {},
    products: {},
    ...over,
  } as unknown as AppDependencies;
}
