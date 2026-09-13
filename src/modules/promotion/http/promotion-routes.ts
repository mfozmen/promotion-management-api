import { Router, type Request, type Response } from 'express';
import { validate } from '../../../shared/http/request-validator.js';
import type { AssignPromotionCommand } from '../commands/assign-promotion-command.js';
import type { CancelPromotionCommand } from '../commands/cancel-promotion-command.js';
import type { CreatePromotionCommand } from '../commands/create-promotion-command.js';
import type { FindPromotionQuery } from '../queries/find-promotion-query.js';
import type { ListPromotionsQuery } from '../queries/list-promotions-query.js';
import {
  assignPromotionInput,
  type AssignPromotion,
} from '../domain/dto/assign-promotion-input.js';
import {
  createPromotionInput,
  type CreatePromotion,
} from '../domain/dto/create-promotion-input.js';
import {
  listPromotionsInput,
  type ListPromotionsInput,
} from '../domain/dto/list-promotions-input.js';
import { promotionIdInput, type PromotionIdInput } from '../domain/dto/promotion-id-input.js';

interface PromotionUseCases {
  create: CreatePromotionCommand;
  assign: AssignPromotionCommand;
  cancel: CancelPromotionCommand;
  find: FindPromotionQuery;
  list: ListPromotionsQuery;
}

const idOf = (req: Request): number => (req.params as unknown as PromotionIdInput).id;

export function promotionRoutes({ create, assign, cancel, find, list }: PromotionUseCases): Router {
  const router = Router();

  router.post(
    '/',
    validate({ body: createPromotionInput }),
    async (req: Request, res: Response) => {
      res.status(201).json(await create.execute(req.body as CreatePromotion));
    },
  );

  router.post(
    '/:id/assign',
    validate({ params: promotionIdInput }),
    validate({ body: assignPromotionInput }),
    async (req: Request, res: Response) => {
      res.status(200).json(await assign.execute(idOf(req), req.body as AssignPromotion));
    },
  );

  router.post(
    '/:id/cancel',
    validate({ params: promotionIdInput }),
    async (req: Request, res: Response) => {
      res.status(200).json(await cancel.execute(idOf(req)));
    },
  );

  router.get('/', validate({ query: listPromotionsInput }), async (req: Request, res: Response) => {
    res.status(200).json(await list.execute(req.query as unknown as ListPromotionsInput));
  });

  router.get(
    '/:id',
    validate({ params: promotionIdInput }),
    async (req: Request, res: Response) => {
      res.status(200).json(await find.execute(idOf(req)));
    },
  );

  return router;
}
