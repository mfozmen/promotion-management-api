import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '@src/app.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { appDeps } from '@tests/app-deps.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let uploads: string;
let sequence = 0;

beforeAll(() => {
  uploads = mkdtempSync(join(tmpdir(), 'pma-uploads-'));
});

afterAll(() => {
  rmSync(uploads, { recursive: true, force: true });
});

const header = 'sku,name,category,price,stock\n';

function vendorCsv(rows: number): Buffer {
  sequence += 1;
  const body = Array.from(
    { length: rows },
    (_, i) => `SKU-${sequence}-${i},name ${i},Electronics,800.00,150\n`,
  ).join('');
  return Buffer.from(header + body);
}

/** The queue the route reaches: every publish is recorded, none is sent. */
function queueRecorder() {
  const published: { name: string; payload: unknown }[] = [];
  return {
    published,
    queue: {
      publish: (name: string, payload: unknown) => {
        published.push({ name, payload });
        return Promise.resolve();
      },
    },
  };
}

const appWith = (sink = queueRecorder()) =>
  createApp(
    appDeps({
      db: db(),
      queue: sink.queue as never,
      uploads: { dir: uploads, chunkBytes: 1024, maxBytes: 5 * 1024 * 1024 },
    }),
  );

describe('POST /api/vendor/imports', () => {
  it('accepts a file, registers it and queues a job per chunk', async () => {
    const sink = queueRecorder();

    const res = await request(appWith(sink))
      .post('/api/vendor/imports')
      .field('vendor', 'acme')
      .attach('file', vendorCsv(200), 'weekly.csv');

    expect(res.status).toBe(202);
    expect(res.body.jobId).toEqual(expect.any(Number));
    expect(res.body.chunksTotal).toBeGreaterThan(1);
    expect(sink.published).toHaveLength(res.body.chunksTotal);
    expect(sink.published[0]?.name).toBe('chunk.process');
  });

  it('writes the file into the upload directory the worker reads', async () => {
    const before = readdirSync(uploads).length;

    const res = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'acme-2')
      .attach('file', vendorCsv(10), 'weekly.csv');

    const [job] = await db()
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, res.body.jobId));
    expect(readdirSync(uploads).length).toBe(before + 1);
    // What is stored is a name inside that directory, never a path: the worker
    // resolves it against its own UPLOAD_DIR from a different filesystem.
    expect(job?.fileRef).not.toContain('/');
    expect(readdirSync(uploads)).toContain(job?.fileRef);
  });

  it('refuses the same bytes twice, whoever sends them', async () => {
    const csv = vendorCsv(10);
    await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'first')
      .attach('file', csv, 'a.csv');

    const res = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'second')
      .attach('file', csv, 'b.csv');

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already/i);
  });

  it('rejects a file sent with no vendor named', async () => {
    // The file is on disk by the time this is checked, so the rejection has to be
    // the caller's mistake rather than a stored job nobody can attribute.
    const res = await request(appWith())
      .post('/api/vendor/imports')
      .attach('file', vendorCsv(5), 'weekly.csv');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/vendor/i);
  });

  it('rejects a request with no file rather than registering nothing', async () => {
    const res = await request(appWith()).post('/api/vendor/imports').field('vendor', 'acme');

    expect(res.status).toBe(400);
  });

  it('rejects a file over the cap', async () => {
    const res = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'acme')
      .attach('file', Buffer.alloc(6 * 1024 * 1024, 'x'), 'huge.csv');

    expect(res.status).toBe(413);
  });
});

describe('POST /api/vendor/imports, upload failures', () => {
  it('says which conflict it is when the vendor already has an import running', async () => {
    // Two unique indexes answer 409 and they mean different things. Reporting a
    // busy vendor as a duplicate file sends the caller to the wrong fix.
    await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'busy-vendor')
      .attach('file', vendorCsv(5), 'first.csv');

    const res = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'busy-vendor')
      .attach('file', vendorCsv(5), 'second.csv');

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already has an import running/);
  });

  it('rejects a file sent under a field the route does not take', async () => {
    // multer raises its own error for an unexpected field, which is the caller's
    // mistake rather than ours: a 400, not the 413 the size limit answers with.
    const res = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'acme')
      .attach('attachment', vendorCsv(5), 'weekly.csv');

    expect(res.status).toBe(400);
  });

  it('refuses a file that is not a csv, rather than rejecting every row later', async () => {
    const res = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'acme-not-csv')
      .attach('file', Buffer.from('not a csv'), 'catalogue.xlsx');

    expect(res.status).toBe(415);
  });
});

describe('GET /api/vendor/imports/:id', () => {
  it('reports what the import has done so far', async () => {
    const created = await request(appWith())
      .post('/api/vendor/imports')
      .field('vendor', 'acme-status')
      .attach('file', vendorCsv(20), 'weekly.csv');

    const res = await request(appWith()).get(`/api/vendor/imports/${created.body.jobId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.body.jobId,
      vendor: 'acme-status',
      status: 'running',
      chunksTotal: created.body.chunksTotal,
      chunksDone: 0,
      rowsProcessed: 0,
      rowsRejected: 0,
    });
  });

  it('answers 404 for an import that does not exist', async () => {
    expect((await request(appWith()).get('/api/vendor/imports/999999')).status).toBe(404);
  });

  it('answers 400 for an id that is not one, rather than a 500 from the column', async () => {
    // A malformed id is a malformed request, the same answer the promotion and
    // storefront routes give. `1e20` would otherwise reach a `bigint` column,
    // where PostgreSQL raises 22003 and the request ends a 500.
    expect((await request(appWith()).get('/api/vendor/imports/1e20')).status).toBe(400);
    expect((await request(appWith()).get('/api/vendor/imports/0x10')).status).toBe(400);
  });
});
