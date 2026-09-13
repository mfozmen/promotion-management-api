import { Router } from 'express';
import type { QueueStats } from '../domain/dto/queue-stats.js';

/** The operator's read-only view of the queues. Express 5 forwards a rejection to the
 *  error handler, so an unreachable Redis is a 500 with the envelope and a logged cause. */
export function adminRouter(reporter: { report(): Promise<QueueStats[]> }): Router {
  const router = Router();

  router.get('/queues/stats', async (_req, res) => {
    res.json({ queues: await reporter.report() });
  });

  return router;
}
