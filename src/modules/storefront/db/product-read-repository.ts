import type { Redis } from 'ioredis';
import { ReadModelUnavailableError } from './read-model-unavailable-error.js';

interface Page {
  category?: string;
  order: 'asc' | 'desc';
  offset: number;
  size: number;
}

export class ProductReadRepository {
  static readonly ALL_PRODUCTS = 'products:all';
  static readonly READY_KEY = 'readmodel:ready';

  constructor(private readonly redis: Redis) {}

  static productKey(id: number | string): string {
    return `product:${String(id)}`;
  }

  static categoryKey(category: string): string {
    return `category:${category}`;
  }

  /** Whether Redis answers at all, which `isReady` cannot say: an unreachable store
   *  and a store with no `readmodel:ready` key both make that method false. */
  async ping(): Promise<void> {
    await this.redis.ping();
  }

  async isReady(): Promise<boolean> {
    const key = ProductReadRepository.READY_KEY;

    return (await this.reached(this.redis.exists(key), key)) === 1;
  }

  /** Absent is `undefined`: an empty hash is how Redis says no key. */
  async find(id: number | string): Promise<Record<string, string> | undefined> {
    const key = ProductReadRepository.productKey(id);
    const hash = await this.reached(this.redis.hgetall(key), key);

    return Object.keys(hash).length === 0 ? undefined : hash;
  }

  /** With REV, Redis expects the maximum first. */
  async page({ category, order, offset, size }: Page): Promise<string[]> {
    const key = ProductReadRepository.listKey(category);

    return this.reached(
      order === 'asc'
        ? this.redis.zrange(key, '-inf', '+inf', 'BYSCORE', 'LIMIT', offset, size)
        : this.redis.zrange(key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, size),
      key,
    );
  }

  async count(category?: string): Promise<number> {
    const key = ProductReadRepository.listKey(category);

    return this.reached(this.redis.zcard(key), key);
  }

  /** One pipeline whatever the page size, never one round trip per product. */
  async findAll(ids: readonly string[]): Promise<(Record<string, string> | undefined)[]> {
    // The member goes to Redis as the index holds it: coercing it would turn a
    // member this class did not write into `product:NaN`.
    const keys = ids.map((id) => ProductReadRepository.productKey(id));
    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.hgetall(key);
    // `exec` is typed nullable: ioredis answers null for a transaction a WATCH
    // aborted, and a pipeline has no WATCH.
    const replies = (await this.reached(pipeline.exec(), ProductReadRepository.ALL_PRODUCTS)) ?? [];

    // Driven by the keys, not the replies: a missing reply and an empty hash are
    // the same fact, the product is not there.
    return keys.map((key, index) => {
      const [error, hash] = replies[index] ?? [null, {}];
      if (error !== null) throw ProductReadRepository.classify(error, key);

      const record = hash as Record<string, string>;

      return Object.keys(record).length === 0 ? undefined : record;
    });
  }

  private static listKey(category?: string): string {
    return category === undefined
      ? ProductReadRepository.ALL_PRODUCTS
      : ProductReadRepository.categoryKey(category);
  }

  /** `WRONGTYPE` is the writer's doing and nothing else is. */
  private static classify(error: unknown, ourKey: string): unknown {
    if (!(error instanceof Error) || !error.message.startsWith('WRONGTYPE')) {
      return new ReadModelUnavailableError('The read model cannot be reached', error);
    }

    const named = new Error(`${error.message} at ${ourKey}`);
    named.name = error.name;

    return named;
  }

  private async reached<T>(reply: Promise<T>, ourKey: string): Promise<T> {
    try {
      return await reply;
    } catch (error) {
      throw ProductReadRepository.classify(error, ourKey);
    }
  }
}
