import type { Redis } from 'ioredis';
import { toProductView } from '../domain/to-product-view.js';
import { ReadModelUnavailable } from './read-model-unavailable.js';

interface Page {
  category?: string;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** The storefront's whole view of Redis: the keys it reads, the commands it
 *  sends and what a failure of one means (ADR-0006). */
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

  /** False until a rebuild has published the key; unreachable is the same
   *  answer to a client as unbuilt, so the caller gets one of them or a 503. */
  async isReady(): Promise<boolean> {
    return (await this.reached(this.redis.exists(ProductReadModel.READY_KEY))) === 1;
  }

  async find(id: number) {
    const key = ProductReadModel.productKey(id);
    const hash = await this.reached(this.redis.hgetall(key), key);

    return Object.keys(hash).length === 0 ? undefined : toProductView(hash);
  }

  /** One ZRANGE for the page and one ZCARD for the total, then a single
   *  pipeline of HGETALLs: three round trips whatever the page size. With REV,
   *  Redis expects the maximum first. */
  async list({ category, order, page, pageSize }: Page) {
    const key =
      category === undefined
        ? ProductReadModel.ALL_PRODUCTS
        : ProductReadModel.categoryKey(category);
    // Named to an operator only when we composed it, never when a caller did.
    const ours = category === undefined ? ProductReadModel.ALL_PRODUCTS : undefined;
    const offset = (page - 1) * pageSize;

    const [ids, total] = await this.reached(
      Promise.all([
        order === 'asc'
          ? this.redis.zrange(key, '-inf', '+inf', 'BYSCORE', 'LIMIT', offset, pageSize)
          : this.redis.zrange(key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, pageSize),
        this.redis.zcard(key),
      ]),
      ours,
    );

    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(ProductReadModel.productKey(Number(id)));
    // `exec` is typed nullable: ioredis answers null for a transaction a WATCH
    // aborted, and a pipeline has no WATCH.
    const replies = (await this.reached(pipeline.exec())) ?? [];
    for (const [index, [error]] of replies.entries()) {
      if (error !== null) {
        throw ProductReadModel.classify(error, ProductReadModel.productKey(Number(ids[index])));
      }
    }

    // A member whose hash is gone is dropped rather than taking the page with
    // it (ADR-0006).
    const present = replies
      .map(([, hash]) => hash as Record<string, string>)
      .filter((hash) => Object.keys(hash).length > 0);

    return { items: present.map(toProductView), total };
  }

  /** Only `WRONGTYPE` is the writer's doing; every other reply, and anything
   *  that is not an error at all, is a reason to come back (REVIEW.md 5.8). */
  private static classify(error: unknown, key?: string): unknown {
    if (!(error instanceof Error) || !error.message.startsWith('WRONGTYPE')) {
      return new ReadModelUnavailable('The read model cannot be reached', error);
    }
    if (key === undefined) return error;

    const named = new Error(`${error.message} at ${key}`);
    named.name = error.name;

    return named;
  }
  /** Wraps the reply and never the parse that follows it. A direct command
   *  rejects with the same shapes a pipeline resolves with, so both go through
   *  one classifier. */
  private async reached<T>(reply: Promise<T>, key?: string): Promise<T> {
    try {
      return await reply;
    } catch (error) {
      throw ProductReadModel.classify(error, key);
    }
  }
}
