import { Router, type Request, type Response } from 'express';
import type { Publish } from '../../../events/publish.js';
import type { Db } from '../../../shared/db/client.js';
import { validate } from '../../../shared/http/request-validator.js';
import { HttpError } from '../../../shared/http/http-error.js';
import type { CreateProduct } from '../domain/dto/create-product-schema.js';
import { createProductSchema } from '../domain/dto/create-product-schema.js';
import { insertProduct } from '../db/insert-product.js';

/**
 * `POST /api/products` only. There is no update or delete: the vendor feed is
 * the only channel that changes a product after it exists (decision K4).
 */
export function productRoutes(db: Db, publish: Publish): Router {
  const router = Router();

  router.post(
    '/',
    validate({ body: createProductSchema }),
    async (req: Request, res: Response) => {
      const result = await insertProduct(db, req.body as CreateProduct);
      if (!result.ok) throw new HttpError('SKU_EXISTS', 'A product with this SKU already exists');

      // After the insert has committed, never inside it: an event carrying an
      // id a rollback would take away sends the worker to recompute a product
      // that does not exist (REVIEW.md 3.4). A single insert commits on its
      // own, so the ordering here is the `await` above.
      //
      // The enqueue is awaited but its failure is not the caller's: the row is
      // written, and losing the write to save the event would be the worse
      // trade. Nothing repairs the read model automatically yet — ADR-0007's
      // reconciler is not built — so until it lands, a lost event means this
      // product is missing from the read model until it changes again.
      await publish('product.upserted', { productIds: [result.product.id] }).catch(
        (error: unknown) => {
          req.log.error(
            { error: { message: error instanceof Error ? error.message : 'unknown' } },
            'product.upserted could not be enqueued; this product stays out of the read model until it changes again',
          );
        },
      );

      res.status(201).json(result.product);
    },
  );

  return router;
}
