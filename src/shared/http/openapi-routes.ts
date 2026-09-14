import { Router, type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './openapi-document.js';

/**
 * `app` arrives as a function because the document is the application read back:
 * these routes are mounted while the application is still being built, and a
 * document taken then would describe only the routes mounted before it.
 */
export function openapiRoutes(app: () => Express): Router {
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.status(200).json(openapiDocument(app()));
  });

  // The page fetches the document rather than being handed a copy of it, so what
  // it renders is what a caller gets from the endpoint beside it.
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/openapi.json' } }),
  );

  return router;
}
