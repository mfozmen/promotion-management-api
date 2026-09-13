import type { Logger } from 'pino';
import type { Publish } from './events/publish.js';
import type { PromotionScheduler } from './modules/promotion/domain/promotion-scheduler.js';
import type { Db } from './shared/db/client.js';

/**
 * `db`, `publish` and `scheduler` are optional because the health probe needs
 * none of them: a process that cannot reach PostgreSQL still has to answer its
 * liveness check, and the routes that do need them are not mounted without them.
 */
export interface AppDependencies {
  logger?: Logger;
  db?: Db;
  publish?: Publish;
  scheduler?: PromotionScheduler;
}
