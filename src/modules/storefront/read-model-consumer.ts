import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Db } from '../../shared/db/client.js';
import { pricingRules } from '../pricing/db/schema/pricing-rules.js';
import { EffectivePriceCalculator } from '../promotion/domain/effective-price-calculator.js';
import { PromotionResolver } from '../promotion/domain/promotion-resolver.js';
import { PromotionRepository } from '../promotion/db/promotion-repository.js';
import { ProductReadRepository } from './db/product-read-repository.js';
import { RebuildReadModelCommand } from './commands/rebuild-read-model-command.js';
import { ProductSourceRepository } from './db/product-source-repository.js';
import { ProductWriteRepository } from './db/product-write-repository.js';
import { ProductPricer } from './domain/product-pricer.js';
import { ProductUpsertedHandler } from './events/product-upserted-handler.js';
import { PromotionChangedHandler } from './events/promotion-changed-handler.js';
import { ReadModelRebuildHandler } from './events/readmodel-rebuild-handler.js';

interface AnnouncementQueue {
  publish(name: 'product.upserted', payload: { productIds: number[] }): Promise<unknown>;
}

/** Everything that writes the read model, built once from the two stores. The
 *  policy is read here rather than per job: a worker holds one until it
 *  restarts, which is the staleness ADR-0004 records. */
export async function readModelConsumer(
  db: Db,
  redis: Redis,
  queue: AnnouncementQueue,
  logger: Logger,
) {
  const source = new ProductSourceRepository(db);
  const pricer = new ProductPricer(
    await PromotionResolver.fromRules(await db.select().from(pricingRules), logger),
    new EffectivePriceCalculator(),
    logger,
  );
  const upserted = new ProductUpsertedHandler(
    source,
    new ProductWriteRepository(redis),
    pricer,
    logger,
  );

  const rebuild = new RebuildReadModelCommand(source, upserted, redis, logger);

  return {
    upserted,
    promotionChanged: new PromotionChangedHandler(
      new PromotionRepository(db),
      source,
      queue,
      logger,
    ),
    rebuild: new ReadModelRebuildHandler(rebuild),
    // The reconciler's drift check needs both halves: what PostgreSQL groups and
    // what the sorted sets list, plus the scoped rebuild that repairs a mismatch.
    source,
    readModel: new ProductReadRepository(redis),
    rebuildCategory: rebuild,
    // The boot path calls this one: the gate that skips a warm read model is
    // inside it, so the entry point names a method rather than deciding.
    rebuildOnBoot: () => rebuild.rebuildUnlessReady(),
  };
}
