import { Redis } from 'ioredis';

/** Generous for a read model on the same network, where the listing's own
 *  three round trips are sub-millisecond, and far below any client's patience. */
const COMMAND_TIMEOUT_MS = 200;

/** The storefront's client, on the read-model database (ADR-0003 keeps the
 *  queue in another). Offline queueing is off, retries are capped and every
 *  command has a deadline: when Redis is unreachable the routes answer 503
 *  with a retry hint, which is a better answer than a request holding a
 *  socket open until it times out. A refused connection fails on its own; a
 *  server that accepts and never replies is what the deadline is for. */
export function createReadModelClient(url: string, database: number): Redis {
  return new Redis(url, {
    db: database,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: COMMAND_TIMEOUT_MS,
  });
}
