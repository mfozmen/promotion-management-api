import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { ProductReadRepository } from '../db/product-read-repository.js';

interface CatalogueSource {
  idsAfter(afterId: number): Promise<number[]>;
  idsInCategory(category: string, afterId: number): Promise<number[]>;
  presentIds(ids: readonly number[]): Promise<Set<number>>;
}

interface Recompute {
  handle(event: { productIds: number[] }): Promise<void>;
}

/** Builds the read model from PostgreSQL and publishes the key that lets the
 *  storefront answer. Why it writes through the compare-and-set and never purges
 *  first, and why two at once need no lock: ADR-0006. */
export class RebuildReadModelCommand {
  /** One page of ids per round, matching the announcement cap. */
  static readonly PAGE = 1_000;

  constructor(
    private readonly source: CatalogueSource,
    private readonly recompute: Recompute,
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  /** Skipped when the key is there: `restart: unless-stopped` makes restarts
   *  routine, and every one of them would otherwise recompute the catalogue. */
  async rebuildUnlessReady(): Promise<boolean> {
    if ((await this.redis.exists(ProductReadRepository.READY_KEY)) === 1) {
      this.logger.info('read model is already published; skipping the boot rebuild');
      return false;
    }

    await this.rebuildAll();
    return true;
  }

  /** The key is published last, so no shopper reads a half-built model. */
  async rebuildAll(): Promise<void> {
    const products = await this.recomputePages((afterId) => this.source.idsAfter(afterId));
    const dropped = await this.dropOrphans();

    await this.redis.set(ProductReadRepository.READY_KEY, '1');
    this.logger.info({ products, dropped }, 'read model rebuilt; storefront open');
  }

  /** Both what PostgreSQL says is in the category and what the sorted set still
   *  lists, which is how a product that left the category is found. */
  async rebuildCategory(category: string): Promise<number> {
    const handled = new Set<number>();
    const recomputed = await this.recomputePages(
      (afterId) => this.source.idsInCategory(category, afterId),
      handled,
    );
    const listed = await this.redis.zrange(ProductReadRepository.categoryKey(category), '0', '-1');
    // Only the ones the source pass did not already write: a 50 000-product
    // category is the flash-sale path, and recomputing it twice doubles the
    // slowest thing the system does.
    const left = listed.map(Number).filter((id) => !handled.has(id));

    for (const productIds of RebuildReadModelCommand.pages(left))
      await this.recompute.handle({ productIds });

    return recomputed + left.length;
  }

  private static *pages(ids: readonly number[]): Generator<number[]> {
    for (let from = 0; from < ids.length; from += RebuildReadModelCommand.PAGE)
      yield ids.slice(from, from + RebuildReadModelCommand.PAGE);
  }

  private async recomputePages(
    page: (afterId: number) => Promise<number[]>,
    handled?: Set<number>,
  ): Promise<number> {
    let afterId = 0;
    let seen = 0;

    for (;;) {
      const productIds = await page(afterId);

      if (productIds.length === 0) return seen;

      await this.recompute.handle({ productIds });
      for (const id of productIds) handled?.add(id);
      seen += productIds.length;
      afterId = productIds[productIds.length - 1]!;
    }
  }

  /** `SCAN` by prefix, never `FLUSHDB`: the queue shares this server in
   *  development. */
  private async dropOrphans(): Promise<number> {
    let cursor = '0';
    let dropped = 0;

    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        ProductReadRepository.productKey('*'),
        'COUNT',
        String(RebuildReadModelCommand.PAGE),
      );
      cursor = next;

      const ids = keys.map((key) => Number(key.slice(key.indexOf(':') + 1)));
      const present = await this.source.presentIds(ids);
      const orphans = ids.filter((id) => !present.has(id));

      if (orphans.length > 0) {
        await this.recompute.handle({ productIds: orphans });
        dropped += orphans.length;
      }
    } while (cursor !== '0');

    return dropped;
  }
}
