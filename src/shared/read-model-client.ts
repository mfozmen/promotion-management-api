import { Redis } from 'ioredis';
import { logger } from './logger.js';

/** Client-side elapsed time, so it must clear this process's own event-loop
 *  lag under load rather than only Redis (ADR-0006). */
const COMMAND_TIMEOUT_MS = 1_000;

/** The storefront's client, on the read-model database (ADR-0003). */
export function createReadModelClient(url: string, database: number): Redis {
  const client = new Redis(url, {
    db: database,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: COMMAND_TIMEOUT_MS,
  });

  // ioredis prints an unhandled `error` outside pino, so a restart's reconnect
  // noise lands as raw text in a structured log.
  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'read model client failed');
  });

  return client;
}
