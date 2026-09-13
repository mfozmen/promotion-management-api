import type { Redis } from 'ioredis';
import { ReadModelUnavailable } from './read-model-unavailable.js';

export class ProductReadModel {
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
    return (await this.reached(this.redis.exists(ProductReadModel.READY_KEY))) === 1;
  }

  async hash(id: number): Promise<Record<string, string>> {
    const key = ProductReadModel.productKey(id);

    return this.reached(this.redis.hgetall(key), key);
  }

  /** With REV, Redis expects the maximum first. */
  async page(key: string, order: 'asc' | 'desc', offset: number, size: number) {
    return this.reached(
      order === 'asc'
        ? this.redis.zrange(key, '-inf', '+inf', 'BYSCORE', 'LIMIT', offset, size)
        : this.redis.zrange(key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, size),
    );
  }

  async count(key: string): Promise<number> {
    return this.reached(this.redis.zcard(key));
  }

  /** One pipeline whatever the page size, never one round trip per product. */
  async hashes(ids: readonly string[]): Promise<Record<string, string>[]> {
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(ProductReadModel.productKey(Number(id)));
    // `exec` is typed nullable: ioredis answers null for a transaction a WATCH
    // aborted, and a pipeline has no WATCH.
    const replies = (await this.reached(pipeline.exec())) ?? [];

    return replies.map(([error, hash], index) => {
      if (error !== null) {
        throw ProductReadModel.classify(error, ProductReadModel.productKey(Number(ids[index])));
      }

      return hash as Record<string, string>;
    });
  }

  /** `WRONGTYPE` is the writer's doing and nothing else is; the key is named
   *  only when this class composed it, never when a caller handed one in. */
  private static classify(error: unknown, ourKey?: string): unknown {
    if (!(error instanceof Error) || !error.message.startsWith('WRONGTYPE')) {
      return new ReadModelUnavailable('The read model cannot be reached', error);
    }
    if (ourKey === undefined) return error;

    const named = new Error(`${error.message} at ${ourKey}`);
    named.name = error.name;

    return named;
  }

  private async reached<T>(reply: Promise<T>, ourKey?: string): Promise<T> {
    try {
      return await reply;
    } catch (error) {
      throw ProductReadModel.classify(error, ourKey);
    }
  }
}
