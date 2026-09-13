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

  static productKey(id: number): string {
    return `product:${String(id)}`;
  }

  static categoryKey(category: string): string {
    return `category:${category}`;
  }

  async isReady(): Promise<boolean> {
    const key = ProductReadRepository.READY_KEY;

    return (await this.reached(this.redis.exists(key), key)) === 1;
  }

  async find(id: number): Promise<Record<string, string>> {
    const key = ProductReadRepository.productKey(id);

    return this.reached(this.redis.hgetall(key), key);
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
  async findAll(ids: readonly string[]): Promise<Record<string, string>[]> {
    const keys = ids.map((id) => ProductReadRepository.productKey(Number(id)));
    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.hgetall(key);
    // `exec` is typed nullable: ioredis answers null for a transaction a WATCH
    // aborted, and a pipeline has no WATCH.
    const replies = (await this.reached(pipeline.exec(), ProductReadRepository.ALL_PRODUCTS)) ?? [];

    // Driven by the keys, not the replies: a reply the pipeline did not return
    // is an absent entry, which is what a caller does with an empty hash anyway.
    return keys.map((key, index) => {
      const [error, hash] = replies[index] ?? [null, {}];
      if (error !== null) throw ProductReadRepository.classify(error, key);

      return hash as Record<string, string>;
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
