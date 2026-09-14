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
 *  storefront answer. Every entry goes through the same compare-and-set the
 *  event handlers use: a prefix purge in front of the rebuild would take each
 *  token minutes before its own write, and a recompute in flight from before the
 *  purge would then find no token and apply unconditionally over newer truth.
 *
 *  Two rebuilds at once are correct and slow, for the same reason. A lock would
 *  buy nothing and can be held by a dead process. */
export class ReadModelRebuild {
  /** One page of ids per round, matching the announcement cap. */
  static readonly PAGE = 1_000;

  constructor(
    private readonly source: CatalogueSource,
    private readonly recompute: Recompute,
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  /** What a worker calls on boot. A rebuild is how the key gets set, so a check
   *  that finds it means some rebuild finished rather than that this one can be
   *  skipped for free. Without it every restart recomputes the whole catalogue,
   *  and `restart: unless-stopped` makes restarts routine. */
  async rebuildUnlessReady(): Promise<boolean> {
    if ((await this.redis.exists(ProductReadRepository.READY_KEY)) === 1) {
      this.logger.info('read model is already published; skipping the boot rebuild');
      return false;
    }

    await this.rebuildAll();
    return true;
  }

  /** The cold start. Every product is recomputed, every entry with nothing
   *  behind it is tombstoned, and only then is the storefront opened. */
  async rebuildAll(): Promise<void> {
    const products = await this.recomputePages((afterId) => this.source.idsAfter(afterId));
    const dropped = await this.dropOrphans();

    await this.redis.set(ProductReadRepository.READY_KEY, '1');
    this.logger.info({ products, dropped }, 'read model rebuilt; storefront open');
  }

  /** One category, for a reconciler that found drift. The entries PostgreSQL
   *  says are in the category and the ones the sorted set still lists are both
   *  recomputed, which is what moves a product that changed category. */
  async rebuildCategory(category: string): Promise<number> {
    const fromSource = await this.recomputePages((afterId) =>
      this.source.idsInCategory(category, afterId),
    );
    const listed = await this.redis.zrange(ProductReadRepository.categoryKey(category), '0', '-1');

    for (const page of ReadModelRebuild.pages(listed.map(Number)))
      await this.recompute.handle({ productIds: page });

    return fromSource;
  }

  private static *pages(ids: readonly number[]): Generator<number[]> {
    for (let from = 0; from < ids.length; from += ReadModelRebuild.PAGE)
      yield ids.slice(from, from + ReadModelRebuild.PAGE);
  }

  private async recomputePages(page: (afterId: number) => Promise<number[]>): Promise<number> {
    let afterId = 0;
    let seen = 0;

    for (;;) {
      const productIds = await page(afterId);

      if (productIds.length === 0) return seen;

      await this.recompute.handle({ productIds });
      seen += productIds.length;
      afterId = productIds[productIds.length - 1]!;
    }
  }

  /** `SCAN` by prefix, never `FLUSHDB`: the queue shares this server in
   *  development and a rebuild is not entitled to anything but its own keys. The
   *  removal itself is the compare-and-set, so a tombstone is left behind. */
  private async dropOrphans(): Promise<number> {
    let cursor = '0';
    let dropped = 0;

    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        ProductReadRepository.productKey('*'),
        'COUNT',
        String(ReadModelRebuild.PAGE),
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
