import { Router, type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './openapi-document.js';

/** `app` is a function because these routes are mounted while it is still being
 *  built: a document taken now would describe only what preceded it. */
export function openapiRoutes(app: () => Express): Router {
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.status(200).json(openapiDocument(app()));
  });

  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/openapi.json' } }),
  );

  return router;
}
