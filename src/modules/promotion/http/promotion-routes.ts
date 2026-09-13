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
import { promotionIdInput, type PromotionIdInput } from '../domain/dto/promotion-id-input.js';
import { promotionWriteError } from './promotion-write-error.js';

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
    validate({ params: promotionIdInput }),
    validate({ body: assignPromotionSchema }),
    async (req: Request, res: Response) => {
      const outcome = await assignPromotion(
        db,
        (req.params as unknown as PromotionIdInput).id,
        req.body as AssignPromotion,
      );
      if (!outcome.ok) throw promotionWriteError(outcome);

      await announcePromotion(outcome.promotion, outcome.now, {
        publish,
        scheduler,
        log: req.log,
      });
      res.status(200).json(outcome.promotion);
    },
  );

  router.post(
    '/:id/cancel',
    validate({ params: promotionIdInput }),
    async (req: Request, res: Response) => {
      const id = (req.params as unknown as PromotionIdInput).id;
      const outcome = await cancelPromotion(db, id);
      if (!outcome.ok) throw promotionWriteError(outcome);

      // Only when this call is what cancelled it: a repeat is a success the
      // caller asked for, and re-announcing would fan out over the category again.
      if (outcome.changed) await announceCancellation(id, { publish, scheduler, log: req.log });
      res.status(200).json(outcome.promotion);
    },
  );

  router.get(
    '/',
    validate({ query: listPromotionsQuerySchema }),
    async (req: Request, res: Response) => {
      res
        .status(200)
        .json({ items: await listPromotions(db, req.query as unknown as ListPromotionsQuery) });
    },
  );

  router.get(
    '/:id',
    validate({ params: promotionIdInput }),
    async (req: Request, res: Response) => {
      const promotion = await findPromotion(db, (req.params as unknown as PromotionIdInput).id);
      if (!promotion) throw createError(404, 'No such promotion');
      res.status(200).json(promotion);
    },
  );

  return router;
}
