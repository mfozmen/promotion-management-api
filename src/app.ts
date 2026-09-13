import express, { type Express } from 'express';
import createError from 'http-errors';
import type { AppDependencies } from './app-dependencies.js';
import { FindProductQuery } from './modules/storefront/queries/find-product-query.js';
import { ListProductsQuery } from './modules/storefront/queries/list-products-query.js';
import { ReadModelReadinessQuery } from './modules/storefront/queries/read-model-readiness-query.js';
import { productReadRoutes } from './modules/storefront/http/product-read-routes.js';
import { ProductRepository } from './modules/catalog/db/product-repository.js';
import { CreateProductCommand } from './modules/catalog/commands/create-product-command.js';
import { productRoutes } from './modules/catalog/http/product-routes.js';
import { PromotionRepository } from './modules/promotion/db/promotion-repository.js';
import { PromotionAnnouncer } from './modules/promotion/domain/promotion-announcer.js';
import { CreatePromotionCommand } from './modules/promotion/commands/create-promotion-command.js';
import { AssignPromotionCommand } from './modules/promotion/commands/assign-promotion-command.js';
import { CancelPromotionCommand } from './modules/promotion/commands/cancel-promotion-command.js';
import { FindPromotionQuery } from './modules/promotion/queries/find-promotion-query.js';
import { ListPromotionsQuery } from './modules/promotion/queries/list-promotions-query.js';
import { promotionRoutes } from './modules/promotion/http/promotion-routes.js';
import { errorHandler } from './shared/http/error-handler.js';
import { httpLogger } from './shared/http/http-logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0009).
const BODY_LIMIT = '100kb';

export function createApp({ logger, db, publish, scheduler, products }: AppDependencies): Express {
  const app = express();
  // Free to remove, and every response including a 404 carries it otherwise.
  app.disable('x-powered-by');
  app.use(httpLogger(logger));
  app.use(express.json({ limit: BODY_LIMIT }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  // Both mount on /products: the read side answers GET, the catalog POST.
  api.use(
    '/products',
    productReadRoutes({
      readiness: new ReadModelReadinessQuery(products),
      find: new FindProductQuery(products),
      list: new ListProductsQuery(products),
    }),
  );
  // The use cases are built here from the repositories, so a route receives
  // what it calls and nothing it could reach around.
  const catalog = new ProductRepository(db);
  const promotions = new PromotionRepository(db);
  const announcer = new PromotionAnnouncer(publish, scheduler, logger);

  api.use('/products', productRoutes(new CreateProductCommand(catalog, publish, logger)));
  api.use(
    '/promotions',
    promotionRoutes({
      create: new CreatePromotionCommand(promotions, announcer),
      assign: new AssignPromotionCommand(promotions, announcer),
      cancel: new CancelPromotionCommand(promotions, announcer),
      find: new FindPromotionQuery(promotions),
      list: new ListPromotionsQuery(promotions),
    }),
  );
  app.use('/api', api);

  app.use((_req, _res, next) => {
    next(createError(404, 'Route not found'));
  });
  app.use(errorHandler);

  return app;
}
