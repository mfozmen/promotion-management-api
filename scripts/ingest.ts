import { eventRegistry } from '../src/events/event-registry.js';
import { eventRouting } from '../src/events/event-routing.js';
import { ImportRegistrar } from '../src/modules/ingestion/jobs/import-registrar.js';
import { loadConfig } from '../src/shared/config.js';
import { createDb, createPool } from '../src/shared/db/client.js';
import { EventQueue } from '../src/shared/queue/event-queue.js';

/**
 * Registers a vendor file as an import and enqueues its chunks.
 *
 *   npm run ingest -- <file> [vendor]
 *
 * There is no upload endpoint — issue #15 was not planned — so this is the entry
 * point, and the work it does is `ImportRegistrar`'s so that it is testable.
 * The worker does the rest.
 */
const [path, vendor = 'cli'] = process.argv.slice(2);

if (path === undefined) {
  console.error('usage: npm run ingest -- <file> [vendor]');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);

try {
  const { jobId, chunksTotal } = await new ImportRegistrar({
    db: createDb(pool),
    enqueue: (chunk) => queue.publish('chunk.process', chunk),
    chunkBytes: config.INGESTION_CHUNK_BYTES,
  }).register(vendor, path);

  console.log(`job ${jobId}: ${chunksTotal} chunks queued from ${path}`);
} finally {
  await queue.close();
  await pool.end();
}
