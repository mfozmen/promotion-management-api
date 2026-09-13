import { Redis } from 'ioredis';

/** Client-side elapsed time, so it must clear this process's own event-loop
 *  lag under load rather than only Redis (ADR-0006). */
const COMMAND_TIMEOUT_MS = 1_000;

/** The storefront's client, on the read-model database (ADR-0003). */
export function createReadModelClient(url: string, database: number): Redis {
  return new Redis(url, {
    db: database,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: COMMAND_TIMEOUT_MS,
  });
}
