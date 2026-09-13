import type { Logger } from 'pino';
import type { Db } from './shared/db/client.js';
import type { Enqueue } from './shared/enqueue.js';
import type { PromotionBoundaries } from './shared/promotion-boundaries.js';

/**
 * `db` and `enqueue` are optional because the health probe needs neither: a
 * process that cannot reach PostgreSQL still has to answer its liveness check,
 * and the routes that do need them are not mounted without them.
 */
export interface AppDependencies {
  logger?: Logger;
  db?: Db;
  enqueue?: Enqueue;
  boundaries?: PromotionBoundaries;
}
