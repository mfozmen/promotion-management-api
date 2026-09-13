import type { Redis } from 'ioredis';
import { toProductView } from '../domain/to-product-view.js';
import { ALL_PRODUCTS } from './all-products-key.js';
import { fromReadModel } from './from-read-model.js';
import { productKey } from './product-key.js';
import { reportGhosts } from './report-ghosts.js';
import { HttpError } from '../../../shared/http/http-error.js';

/** Undefined when the read model holds no such product, so the route decides
 *  the status rather than the store. A miss costs a second command to tell an
 *  absent product from one whose hash a rebuild has already unlinked: the
 *  listing calls that state a rebuild in progress, and a 404 for it is cached
 *  by every crawler and CDN that sees it. The hit path stays one command. */
export async function findProduct(redis: Redis, id: number) {
  const hash = await fromReadModel(redis.hgetall(productKey(id)));
  if (Object.keys(hash).length > 0) return toProductView(hash);

  const listed = await fromReadModel(redis.zscore(ALL_PRODUCTS, String(id)));

  if (listed !== null) {
    // Counted, not just answered: a writer that died between UNLINK and ZREM
    // leaves this member for ever, and the 503 it produces is the same code a
    // whole-model outage sends, so nothing else would tell them apart.
    reportGhosts(ALL_PRODUCTS, 1);

    throw new HttpError('READ_MODEL_NOT_READY', 'The read model is still being built');
  }

  return undefined;
}
