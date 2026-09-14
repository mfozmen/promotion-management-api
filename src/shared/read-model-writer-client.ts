import { Redis } from 'ioredis';
import { logger } from './logger.js';

/**
 * The writer's client, on the read-model database. It takes none of the storefront
 * client's limits: one retry and a one-second command timeout are right for a
 * request someone is waiting on and wrong for a rebuild's pipelines, which should
 * wait out a reconnect rather than fail a page of a hundred thousand products.
 */
export function createReadModelWriterClient(url: string, database: number): Redis {
  const client = new Redis(url, { db: database });

  // ioredis prints an unhandled `error` as raw text outside pino, so a restart's
  // reconnect noise lands in a structured log as something no scraper can read.
  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'read model writer client failed');
  });

  return client;
}
