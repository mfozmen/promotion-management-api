import { Redis } from 'ioredis';

/** This is a client-side deadline: it measures elapsed time, which includes
 *  event-loop lag, not just Redis. The listing at the page-size cap measures
 *  5-9 ms warm, but ADR-0009 records 130-192 ms p99 on a route that only
 *  serialises a constant at 100 connections, so a 200 ms budget would have
 *  answered 503 under load rather than during an outage — the opposite of the
 *  point. A second is far below any client's patience and still bounds a
 *  partition to a second per request instead of tens of them. */
const COMMAND_TIMEOUT_MS = 1_000;

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
