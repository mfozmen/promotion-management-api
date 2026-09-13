import type { Logger } from 'pino';
import type { PromotionScheduler } from './modules/promotion/domain/promotion-scheduler.js';
import type { ProductReadRepository } from './modules/storefront/db/product-read-repository.js';
import type { Db } from './shared/db/client.js';
import type { Queue } from 'bullmq';

/** Every dependency is required and every route is mounted: building a `Db` or
 *  a repository opens no connection, so the health probe answers either way. */
export interface AppDependencies {
  logger: Logger;
  db: Db;
  /** Structural, not `EventQueue`: `createApp` hands each use case the one call
   *  it makes, and a module that imported the catalogue would reverse
   *  ADR-0008's `events → modules` direction. */
  queue: {
    publish(name: 'product.upserted', payload: { productIds: number[] }): Promise<unknown>;
    publish(name: 'promotion.changed', payload: { promotionId: number }): Promise<unknown>;
  };
  scheduler: PromotionScheduler;
  products: ProductReadRepository;
  /** The queues themselves, for the dashboard mounted outside `/api`. Separate from
   *  `queue` above, which is the one publish call a use case makes. */
  queues: { all(): Queue[] };
}
