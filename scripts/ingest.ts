import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { eventRegistry } from '../src/events/event-registry.js';
import { eventRouting } from '../src/events/event-routing.js';
import { RegisterImportCommand } from '../src/modules/ingestion/commands/register-import-command.js';
import { loadConfig } from '../src/shared/config.js';
import { createDb, createPool } from '../src/shared/db/client.js';
import { EventQueue } from '../src/shared/queue/event-queue.js';

/**
 * Registers a vendor file as an import and enqueues its chunks.
 *
 *   npm run ingest -- <file> [vendor]
 *
 * There is no upload endpoint — issue #15 was not planned — so this is the entry
 * point, and the work it does is `RegisterImportCommand`'s so that it is testable.
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
  // Copied into the upload directory first, because what is stored is a name
  // inside it rather than a path: the worker reads the file from a different
  // filesystem — the container mounts the uploads volume and knows nothing of a
  // host path — so a file left where the caller had it is one the reader cannot
  // open. Copying is also what an upload route would do.
  await mkdir(config.UPLOAD_DIR, { recursive: true });
  const fileRef = `${randomUUID()}${extname(path)}`;
  await copyFile(path, join(config.UPLOAD_DIR, fileRef));

  const { jobId, chunksTotal } = await new RegisterImportCommand({
    db: createDb(pool),
    enqueue: (chunk) => queue.publish('chunk.process', chunk),
    chunkBytes: config.INGESTION_CHUNK_BYTES,
    uploadDir: config.UPLOAD_DIR,
  }).register(vendor, fileRef);

  console.log(`job ${jobId}: ${chunksTotal} chunks queued from ${fileRef}`);
} finally {
  await queue.close();
  await pool.end();
}
