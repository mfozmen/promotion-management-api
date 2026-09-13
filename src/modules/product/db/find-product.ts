import type { Redis } from 'ioredis';
import { toProductView } from '../domain/to-product-view.js';
import { productKey } from './product-key.js';

/** Undefined when the read model holds no such product, so the route decides
 *  the status rather than the store. */
export async function findProduct(redis: Redis, id: number) {
  const hash = await redis.hgetall(productKey(id));

  return Object.keys(hash).length === 0 ? undefined : toProductView(hash);
}
