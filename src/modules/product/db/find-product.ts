import type { Redis } from 'ioredis';
import { toProductView } from '../domain/to-product-view.js';
import { ALL_PRODUCTS } from './all-products-key.js';
import { DETAIL_ORPHANS } from './detail-orphans-key.js';
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
  const hash = await fromReadModel(redis.hgetall(productKey(id)), productKey(id));
  if (Object.keys(hash).length > 0) return toProductView(hash);

  const listed = await fromReadModel(redis.zscore(ALL_PRODUCTS, String(id)));

  if (listed !== null) {
    // Counted under its own name: a writer that died between UNLINK and ZREM
    // leaves this member for ever, and 500 hits on one permanent orphan reads
    // exactly like 500 pages each dropping a different member during a rebuild
    // if both are filed under the index they share.
    reportGhosts(DETAIL_ORPHANS, 1);

    throw new HttpError('READ_MODEL_NOT_READY', 'This product is mid-rebuild or orphaned');
  }

  return undefined;
}
