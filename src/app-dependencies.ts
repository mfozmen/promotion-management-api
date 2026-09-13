import type { Logger } from 'pino';
import type { Publish } from './events/publish.js';
import type { PromotionScheduler } from './modules/promotion/domain/promotion-scheduler.js';
import type { ProductReadRepository } from './modules/storefront/db/product-read-repository.js';
import type { Db } from './shared/db/client.js';

/**
 * Every dependency is required and every route is mounted. They were optional
 * so the health probe could answer without PostgreSQL, but building a `Db` or a
 * repository opens no connection — the probe answers either way — while a
 * missing one produced an app that served 404s instead of failing to start.
 */
export interface AppDependencies {
  logger: Logger;
  db: Db;
  publish: Publish;
  scheduler: PromotionScheduler;
  products: ProductReadRepository;
}
