import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
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
 * The upload endpoint (issue #15) is not built yet, so this is the entry
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

  const outcome = await new RegisterImportCommand({
    db: createDb(pool),
    enqueue: (chunk) => queue.publish('chunk.process', chunk),
    chunkBytes: config.INGESTION_CHUNK_BYTES,
    uploadDir: config.UPLOAD_DIR,
  }).execute(vendor, fileRef);

  if (!outcome.ok) {
    // The copy above is referenced by nothing once the registration is refused.
    await rm(join(config.UPLOAD_DIR, fileRef), { force: true });
    console.error(
      outcome.reason === 'vendor-busy'
        ? `${vendor} already has an import running; wait for it to finish`
        : 'a file with these contents has already been registered',
    );
    process.exitCode = 1;
  } else {
    console.log(`job ${outcome.jobId}: ${outcome.chunksTotal} chunks queued from ${fileRef}`);
  }
} finally {
  await queue.close();
  await pool.end();
}
