import { Redis } from 'ioredis';

/** The storefront's client, on the read-model database (ADR-0003 keeps the
 *  queue in another). Offline queueing is off and retries are capped: when
 *  Redis is unreachable the routes answer 503 with a retry hint, which is a
 *  better answer than a request holding a socket open until it times out. */
export function createReadModelClient(url: string, database: number): Redis {
  return new Redis(url, {
    db: database,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
}
