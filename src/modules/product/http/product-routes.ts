import { Router, type Request, type Response } from 'express';
import { validate } from '../../../shared/http/request-validator.js';
import type { CreateProductCommand } from '../commands/create-product-command.js';
import { createProductInput, type CreateProduct } from '../domain/dto/create-product-input.js';

/**
 * `POST /api/products` only. There is no update or delete: the vendor feed is
 * the only channel that changes a product after it exists (decision K4).
 */
export function productRoutes(create: CreateProductCommand): Router {
  const router = Router();

  router.post('/', validate({ body: createProductInput }), async (req: Request, res: Response) => {
    res.status(201).json(await create.execute(req.body as CreateProduct));
  });

  return router;
}
