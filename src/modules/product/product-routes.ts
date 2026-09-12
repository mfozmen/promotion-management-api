import { Router } from 'express';
import type { Enqueue } from '../../shared/enqueue.js';
import type { Db } from '../../shared/db/client.js';
import { validate } from '../../middleware/request-validator.js';
import { HttpError } from '../../shared/http-error.js';
import { createProductSchema } from './create-product-schema.js';
import { insertProduct } from './insert-product.js';

/**
 * `POST /api/products` only. There is no update or delete: the vendor feed is
 * the only channel that changes a product after it exists (decision K4).
 */
export function productRoutes(db: Db, enqueue: Enqueue): Router {
  const router = Router();

  router.post('/', validate({ body: createProductSchema }), (req, res, next) => {
    void (async () => {
      try {
        const result = await insertProduct(db, req.body as never);
        if (!result.ok) {
          next(new HttpError('SKU_EXISTS', 'A product with this SKU already exists'));
          return;
        }

        // After the insert has committed, never inside it: an event carrying an
        // id a rollback would take away sends the worker to recompute a product
        // that does not exist (REVIEW.md 3.4). A single insert commits on its
        // own, so the ordering here is the `await` above.
        //
        // The enqueue is awaited but its failure is not the caller's: the row is
        // written, and the reconciler repairs a read model that missed an event
        // within five minutes (ADR-0007). Losing the write to save the event
        // would be the worse trade.
        await enqueue('product.upserted', { productIds: [result.product.id] }).catch(
          (error: unknown) => {
            req.log.error(
              { error: { message: error instanceof Error ? error.message : 'unknown' } },
              'product.upserted could not be enqueued; the reconciler will repair',
            );
          },
        );

        res.status(201).json(result.product);
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
