import type { Redis } from 'ioredis';
import { toProductView } from '../domain/to-product-view.js';
import { ALL_PRODUCTS } from './all-products-key.js';
import { categoryKey } from './category-key.js';
import { fromReadModel } from './from-read-model.js';
import { productKey } from './product-key.js';
import { replyFailure } from './reply-failure.js';
import { reportGhosts } from './report-ghosts.js';

interface Page {
  category?: string;
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

  const [ids, total] = await fromReadModel(
    Promise.all([
      order === 'asc'
        ? redis.zrange(key, '-inf', '+inf', 'BYSCORE', 'LIMIT', offset, pageSize)
        : redis.zrange(key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, pageSize),
      redis.zcard(key),
    ]),
  );

  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.hgetall(productKey(Number(id)));
  // `exec` is typed nullable: ioredis answers null for a transaction a WATCH
  // aborted, and a pipeline has no WATCH.
  const replies = (await fromReadModel(pipeline.exec())) ?? [];
  for (const [error] of replies) {
    if (error !== null) throw replyFailure(error);
  }

  // A member whose hash is gone is a rebuild in progress, not a bad page: the
  // ids outlive the hashes while a category is rewritten. One absent product
  // must not take the other ninety-nine with it, so it is dropped and counted.
  // A hash that is present but incomplete still throws, because that is a
  // price the writer got wrong rather than one it has not written yet.
  const present = replies
    .map(([, hash]) => hash as Record<string, string>)
    .filter((hash) => Object.keys(hash).length > 0);
  if (present.length < replies.length) reportGhosts(key, replies.length - present.length);

  return { items: present.map(toProductView), total };
}
