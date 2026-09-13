import type { Redis } from 'ioredis';
import { toProductView } from '../domain/to-product-view.js';
import { ALL_PRODUCTS, categoryKey, productKey } from './read-model-keys.js';

interface Page {
  category?: string | undefined;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** One ZRANGE for the page and one ZCARD for the total, then a single pipeline
 *  of HGETALLs: three round trips whatever the page size, never one per
 *  product. With REV, Redis expects the maximum first. */
export async function listProducts(redis: Redis, { category, order, page, pageSize }: Page) {
  const key = category === undefined ? ALL_PRODUCTS : categoryKey(category);
  const offset = (page - 1) * pageSize;

  const [ids, total] = await Promise.all([
    order === 'asc'
      ? redis.zrange(key, '-inf', '+inf', 'BYSCORE', 'LIMIT', offset, pageSize)
      : redis.zrange(key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, pageSize),
    redis.zcard(key),
  ]);

  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.hgetall(productKey(id));
  // `exec` is typed nullable: ioredis answers null for a transaction a WATCH
  // aborted, and a pipeline has no WATCH.
  const replies = (await pipeline.exec()) ?? [];

  return {
    items: replies.map(([, hash]) => toProductView(hash as Record<string, string>)),
    total,
  };
}
