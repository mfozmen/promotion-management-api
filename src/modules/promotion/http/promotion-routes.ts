import { Router, type Request, type Response } from 'express';
import createError from 'http-errors';
import { validate } from '../../../shared/http/request-validator.js';
import type { Db } from '../../../shared/db/client.js';
import type { Publish } from '../../../events/publish.js';
import type { PromotionScheduler } from '../domain/promotion-scheduler.js';
import { assignPromotion } from '../db/assign-promotion.js';
import { cancelPromotion } from '../db/cancel-promotion.js';
import { findPromotion } from '../db/find-promotion.js';
import { insertPromotion } from '../db/insert-promotion.js';
import { listPromotions } from '../db/list-promotions.js';
import { announceCancellation } from './announce-cancellation.js';
import { announcePromotion } from './announce-promotion.js';
import type { AssignPromotion } from '../domain/dto/assign-promotion-schema.js';
import { assignPromotionSchema } from '../domain/dto/assign-promotion-schema.js';
import type { CreatePromotion } from '../domain/dto/create-promotion-schema.js';
import { createPromotionSchema } from '../domain/dto/create-promotion-schema.js';
import type { ListPromotionsQuery } from '../domain/dto/list-promotions-query-schema.js';
import { listPromotionsQuerySchema } from '../domain/dto/list-promotions-query-schema.js';
import { promotionWriteError } from './promotion-write-error.js';

// Anything that is not one positive decimal integer is a URL naming no
// promotion, which is a 404 rather than a 400: the caller asked for a thing, not
// with a bad body.
//
// The pattern does the work rather than `Number`, which accepts `0x10` as 16 and
// `1e20` as an integer — and `1e20` reaches a `bigint` column, where PostgreSQL
// raises 22003 and the request ends as a 500 (REVIEW.md 8.2).
const ID_PATTERN = /^[1-9]\d*$/;

const idFrom = (value: unknown): number => {
  const id = typeof value === 'string' && ID_PATTERN.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(id)) throw createError(404, 'No such promotion');
  return id;
};

export function promotionRoutes(db: Db, publish: Publish, scheduler: PromotionScheduler): Router {
  const router = Router();

  router.post(
    '/',
    validate({ body: createPromotionSchema }),
    async (req: Request, res: Response) => {
      const outcome = await insertPromotion(db, req.body as CreatePromotion);
      if (!outcome.ok) throw promotionWriteError(outcome);

      // A draft has no target and no boundaries to schedule; it changes no price.
      if (outcome.promotion.status === 'active') {
        await announcePromotion(outcome.promotion, outcome.now, {
          publish,
          scheduler,
          log: req.log,
        });
      }
      res.status(201).json(outcome.promotion);
    },
  );

  router.post(
    '/:id/assign',
    validate({ body: assignPromotionSchema }),
    async (req: Request, res: Response) => {
      const outcome = await assignPromotion(db, idFrom(req.params.id), req.body as AssignPromotion);
      if (!outcome.ok) throw promotionWriteError(outcome);

      await announcePromotion(outcome.promotion, outcome.now, {
        publish,
        scheduler,
        log: req.log,
      });
      res.status(200).json(outcome.promotion);
    },
  );

  router.post('/:id/cancel', async (req: Request, res: Response) => {
    const id = idFrom(req.params.id);
    const outcome = await cancelPromotion(db, id);
    if (!outcome.ok) throw promotionWriteError(outcome);

    // Only when this call is what cancelled it: a repeat is a success the
    // caller asked for, and re-announcing would fan out over the category again.
    if (outcome.changed) await announceCancellation(id, { publish, scheduler, log: req.log });
    res.status(200).json(outcome.promotion);
  });

  router.get(
    '/',
    validate({ query: listPromotionsQuerySchema }),
    async (req: Request, res: Response) => {
      res
        .status(200)
        .json({ items: await listPromotions(db, req.query as unknown as ListPromotionsQuery) });
    },
  );

  router.get('/:id', async (req: Request, res: Response) => {
    const promotion = await findPromotion(db, idFrom(req.params.id));
    if (!promotion) throw createError(404, 'No such promotion');
    res.status(200).json(promotion);
  });

  return router;
}
