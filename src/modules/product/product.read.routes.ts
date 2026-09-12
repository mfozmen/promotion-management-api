import { Router, type RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { validate } from '../../middleware/request-validator.js';
import { HttpError } from '../../shared/http-error.js';
import { ALL_PRODUCTS, categoryKey, productKey, READY_KEY } from '../../shared/read-model-keys.js';

/** A page is capped server side: the listing fans out one HGETALL per id, so
 *  the page size is the fan-out (REVIEW.md 5.5, 6.21). */
const MAX_PAGE_SIZE = 100;

const listQuery = z.strictObject({
  category: z.string().min(1).optional(),
  // One sort exists, and naming it is how a client asks for the default rather
  // than discovering later that the parameter was ignored.
  sort: z.literal('effectivePrice').optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

const detailParams = z.strictObject({ id: z.coerce.number().int().min(1) });

/** Redis stores strings, so the hash is coerced rather than trusted. An entry
 *  missing a field is a bug in the writer, and the honest answer is a 500 the
 *  operator sees: serving a product at a price of zero because a field was
 *  absent is the silent kind of wrong this layer exists to avoid. */
const storedProduct = z.object({
  id: z.coerce.number().int(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  basePriceCents: z.coerce.number().int(),
  effectivePriceCents: z.coerce.number().int(),
  stockQuantity: z.coerce.number().int(),
  promotionId: z.coerce.number().int().optional(),
  // Defaulted rather than optional: the writer writes the pair together, and
  // a missing display name is cosmetic where a missing price is not.
  promotionName: z.string().default(''),
});

const toView = (hash: Record<string, string>) => {
  const { promotionId, promotionName, ...product } = storedProduct.parse(hash);

  return {
    ...product,
    promotion: promotionId === undefined ? null : { id: promotionId, name: promotionName },
  };
};

/** The read model is the only store these routes may touch, so an unbuilt one
 *  is a 503 rather than a fallback query (ADR-0006, REVIEW.md 5.1, 5.7). */
const requireReadModel =
  (redis: Redis): RequestHandler =>
  (_req, _res, next) => {
    redis
      .exists(READY_KEY)
      .then((ready) => {
        next(
          ready === 1
            ? undefined
            : new HttpError('READ_MODEL_NOT_READY', 'The read model is still being built'),
        );
      })
      .catch(next);
  };

export function productReadRoutes(redis: Redis): Router {
  const router = Router();
  router.use(requireReadModel(redis));

  router.get('/', validate({ query: listQuery }), (req, res, next) => {
    const { category, order, page, pageSize } = req.query as unknown as z.infer<typeof listQuery>;
    const key = category === undefined ? ALL_PRODUCTS : categoryKey(category);
    const offset = (page - 1) * pageSize;

    // One ZRANGE for the page and one ZCARD for the total, then a single
    // pipeline of HGETALLs: two round trips plus one, never one per product
    // (REVIEW.md 6.4). With REV, Redis expects the maximum first.
    const ids =
      order === 'asc'
        ? redis.zrange(key, '-inf', '+inf', 'BYSCORE', 'LIMIT', offset, pageSize)
        : redis.zrange(key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, pageSize);

    Promise.all([ids, redis.zcard(key)])
      .then(async ([pageIds, total]) => {
        const pipeline = redis.pipeline();
        for (const id of pageIds) pipeline.hgetall(productKey(id));
        // `exec` is typed nullable: ioredis returns null for a transaction a
        // WATCH aborted. A pipeline has no WATCH, so an empty page is the
        // reachable version of the same shape.
        const replies = (await pipeline.exec()) ?? [];

        res.json({
          items: replies.map(([, hash]) => toView(hash as Record<string, string>)),
          page,
          pageSize,
          total,
        });
      })
      .catch(next);
  });

  router.get('/:id', validate({ params: detailParams }), (req, res, next) => {
    const { id } = req.params as unknown as z.infer<typeof detailParams>;

    redis
      .hgetall(productKey(id))
      .then((hash) => {
        if (Object.keys(hash).length === 0) {
          throw new HttpError('NOT_FOUND', 'Product not found');
        }
        res.json(toView(hash));
      })
      .catch(next);
  });

  return router;
}
