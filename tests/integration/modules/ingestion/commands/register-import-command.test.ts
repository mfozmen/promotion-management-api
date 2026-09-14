import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegisterImportCommand } from '@src/modules/ingestion/commands/register-import-command.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let dir: string;
let sequence = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-register-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const header = 'sku,name,category,price,stock\n';

function vendorFile(rows: number): string {
  sequence += 1;
  const body = Array.from(
    { length: rows },
    (_, i) => `SKU-${sequence}-${i},name ${i},Electronics,800.00,150\n`,
  ).join('');
  const name = `vendor-${sequence}.csv`;
  writeFileSync(join(dir, name), header + body);
  return name;
}

/** Collects what was enqueued, so a test can see one job per chunk and no more. */
function recorder() {
  const enqueued: { jobId: number; chunkIndex: number }[] = [];
  return {
    enqueued,
    enqueue: (chunk: { jobId: number; chunkIndex: number }) => {
      enqueued.push(chunk);
      return Promise.resolve();
    },
  };
}

/** A vendor per test: `ingestion_jobs_one_running_per_vendor` allows one running job each. */
const vendor = () => `vendor-${sequence}`;

const registrarWith = (
  enqueue: (chunk: { jobId: number; chunkIndex: number }) => Promise<unknown>,
  chunkBytes = 1024,
) => new RegisterImportCommand({ db: db(), enqueue, chunkBytes, uploadDir: dir });

const chunksOf = (jobId: number) =>
  db()
    .select()
    .from(ingestionChunks)
    .where(eq(ingestionChunks.jobId, jobId))
    .orderBy(asc(ingestionChunks.chunkIndex));

describe('RegisterImportCommand', () => {
  it('stores the job, its chunks and one queued job per chunk', async () => {
    const path = vendorFile(200);
    const sink = recorder();

    const outcome = await registrarWith(sink.enqueue).execute(vendor(), path);
    if (!outcome.ok) throw new Error('expected a registration');
    const { jobId, chunksTotal } = outcome;

    const chunks = await chunksOf(jobId);
    expect(chunks).toHaveLength(chunksTotal);
    expect(chunksTotal).toBeGreaterThan(1);
    expect(sink.enqueued).toEqual(chunks.map((c) => ({ jobId, chunkIndex: c.chunkIndex })));
  });

  it('starts every chunk at its own offset, so nothing is read twice or skipped', async () => {
    const path = vendorFile(200);

    const outcome = await registrarWith(recorder().enqueue).execute(vendor(), path);
    if (!outcome.ok) throw new Error('expected a registration');

    const chunks = await chunksOf(outcome.jobId);
    expect(chunks[0]?.startOffset).toBe(Buffer.byteLength(header));
    for (const chunk of chunks) expect(chunk.nextOffset).toBe(chunk.startOffset);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]?.startOffset).toBe(chunks[i - 1]?.endOffset);
    }
  });

  it('records the file so a second registration of the same bytes is refused', async () => {
    // `file_sha256` is unique. The same file twice is a vendor resending, not a
    // second import, and the constraint is what decides that rather than a
    // check-then-insert (REVIEW.md 2.1).
    const path = vendorFile(10);
    await registrarWith(recorder().enqueue).execute(`${vendor()}-first`, path);

    // A different vendor, so the refusal is the file's hash and not the
    // one-running-job-per-vendor index answering for it.
    expect(await registrarWith(recorder().enqueue).execute(`${vendor()}-second`, path)).toEqual({
      ok: false,
      reason: 'duplicate-file',
    });
  });

  it('enqueues nothing when the file has no rows to process', async () => {
    sequence += 1;
    const path = `empty-${sequence}.csv`;
    writeFileSync(join(dir, path), header);
    const sink = recorder();

    const outcome = await registrarWith(sink.enqueue).execute(vendor(), path);
    if (!outcome.ok) throw new Error('expected a registration');
    const { chunksTotal } = outcome;

    expect(chunksTotal).toBe(0);
    expect(sink.enqueued).toEqual([]);
  });

  it('enqueues only after the rows are committed, so no worker claims a chunk that is not there', async () => {
    // A queued job is visible to a worker the instant it is written. Enqueueing
    // inside the transaction let a worker claim a chunk before its row existed:
    // `claimChunk` matches nothing, returns `claimed: false` exactly as it does
    // for a duplicate delivery, and nothing re-enqueues it — one chunk of the
    // import silently never runs (REVIEW.md 3.4).
    const path = vendorFile(50);
    const seen: number[] = [];

    await registrarWith(async ({ jobId }) => {
      // What a worker would see the moment the job reaches the queue.
      seen.push((await chunksOf(jobId)).length);
    }).execute(vendor(), path);

    expect(seen.length).toBeGreaterThan(0);
    for (const count of seen) expect(count).toBeGreaterThan(0);
  });
});
