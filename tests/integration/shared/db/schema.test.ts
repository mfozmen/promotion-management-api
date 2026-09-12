import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ingestionChunks,
  ingestionJobs,
  products,
  promotions,
  reconcilerState,
} from '../../../../src/shared/db/schema.js';
import { sqlStateOf, useTestDatabase } from '../../db.js';

const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const DEADLOCK_DETECTED = '40P01';

const JANUARY = new Date('2026-01-01T00:00:00Z');
const FEBRUARY = new Date('2026-02-01T00:00:00Z');
const MARCH = new Date('2026-03-01T00:00:00Z');
const APRIL = new Date('2026-04-01T00:00:00Z');

const db = useTestDatabase();

let skuCounter = 0;

async function insertProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  skuCounter += 1;
  const [row] = await db()
    .insert(products)
    .values({
      sku: `SKU-${skuCounter}`,
      name: 'Kırmızı Kalem',
      category: 'stationery',
      basePriceCents: 1999,
      stockQuantity: 10,
      ...overrides,
    })
    .returning({ id: products.id });
  return row!.id;
}

beforeEach(async () => {
  await db().execute(
    sql`truncate ${ingestionChunks}, ${ingestionJobs}, ${promotions}, ${products} restart identity cascade`,
  );
});

describe('migration', () => {
  it('creates btree_gist and every enum the design names', async () => {
    const extensions = await db().execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'btree_gist'`,
    );
    const enums = await db().execute<{ typname: string }>(
      sql`select typname from pg_type where typtype = 'e' order by typname`,
    );

    expect(extensions.rows).toHaveLength(1);
    expect(enums.rows.map((row) => row.typname)).toEqual([
      'chunk_status',
      'ingestion_status',
      'pricing_rule_type',
      'promotion_discount_type',
      'promotion_status',
    ]);
  });

  it('holds the reconciler watermark in a single row', async () => {
    expect(await sqlStateOf(db().insert(reconcilerState).values({}))).toBe(UNIQUE_VIOLATION);
    expect(await sqlStateOf(db().insert(reconcilerState).values({ id: false }))).toBe(
      CHECK_VIOLATION,
    );
  });
});

describe('promotions exclusion constraints', () => {
  it('rejects two overlapping active promotions on one product', async () => {
    const productId = await insertProduct();
    const promotion = {
      name: 'January sale',
      discountType: 'percentage' as const,
      value: 1000,
      startsAt: JANUARY,
      endsAt: MARCH,
      productId,
      status: 'active' as const,
    };

    await db().insert(promotions).values(promotion);

    expect(
      await sqlStateOf(
        db()
          .insert(promotions)
          .values({ ...promotion, name: 'February sale', startsAt: FEBRUARY, endsAt: APRIL }),
      ),
    ).toBe(EXCLUSION_VIOLATION);
  });

  it('rejects two overlapping active promotions on one category', async () => {
    const promotion = {
      name: 'Stationery week',
      discountType: 'fixed' as const,
      value: 500,
      startsAt: JANUARY,
      endsAt: MARCH,
      category: 'stationery',
      status: 'active' as const,
    };

    await db().insert(promotions).values(promotion);

    expect(
      await sqlStateOf(
        db()
          .insert(promotions)
          .values({ ...promotion, name: 'Stationery month', startsAt: FEBRUARY, endsAt: APRIL }),
      ),
    ).toBe(EXCLUSION_VIOLATION);
  });

  it('accepts an abutting window, because the range is half-open', async () => {
    const productId = await insertProduct();
    const promotion = {
      name: 'First',
      discountType: 'fixed' as const,
      value: 100,
      startsAt: JANUARY,
      endsAt: FEBRUARY,
      productId,
      status: 'active' as const,
    };

    await db().insert(promotions).values(promotion);
    await db()
      .insert(promotions)
      .values({ ...promotion, name: 'Second', startsAt: FEBRUARY, endsAt: MARCH });

    expect(await db().select({ id: promotions.id }).from(promotions)).toHaveLength(2);
  });

  it('lets a cancelled promotion be replaced on the very same window', async () => {
    const productId = await insertProduct();
    const promotion = {
      name: 'Cancelled sale',
      discountType: 'percentage' as const,
      value: 2500,
      startsAt: JANUARY,
      endsAt: MARCH,
      productId,
      status: 'cancelled' as const,
      cancelledAt: JANUARY,
    };

    await db().insert(promotions).values(promotion);
    await db()
      .insert(promotions)
      .values({ ...promotion, name: 'Replacement', status: 'active', cancelledAt: null });

    expect(await db().select({ id: promotions.id }).from(promotions)).toHaveLength(2);
  });

  it('ignores drafts, so two untargeted drafts can share a window', async () => {
    const draft = {
      name: 'Draft one',
      discountType: 'fixed' as const,
      value: 100,
      startsAt: JANUARY,
      endsAt: MARCH,
      status: 'draft' as const,
    };

    await db().insert(promotions).values(draft);
    await db()
      .insert(promotions)
      .values({ ...draft, name: 'Draft two' });

    expect(await db().select({ id: promotions.id }).from(promotions)).toHaveLength(2);
  });
});

describe('promotions check constraints', () => {
  it('accepts a draft with no target and rejects a draft that carries one', async () => {
    const productId = await insertProduct();
    const draft = {
      name: 'Unassigned draft',
      discountType: 'percentage' as const,
      value: 1000,
      startsAt: JANUARY,
      endsAt: MARCH,
      status: 'draft' as const,
    };

    await db().insert(promotions).values(draft);

    expect(
      await sqlStateOf(
        db()
          .insert(promotions)
          .values({ ...draft, productId }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlStateOf(
        db()
          .insert(promotions)
          .values({ ...draft, category: 'stationery' }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('requires an active promotion to carry exactly one target', async () => {
    const productId = await insertProduct();
    const active = {
      name: 'Active',
      discountType: 'percentage' as const,
      value: 1000,
      startsAt: JANUARY,
      endsAt: MARCH,
      status: 'active' as const,
    };

    expect(await sqlStateOf(db().insert(promotions).values(active))).toBe(CHECK_VIOLATION);
    expect(
      await sqlStateOf(
        db()
          .insert(promotions)
          .values({ ...active, productId, category: 'stationery' }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('requires ends_at to be strictly after starts_at', async () => {
    const zeroLength = {
      name: 'Zero length',
      discountType: 'fixed' as const,
      value: 100,
      startsAt: MARCH,
      endsAt: MARCH,
      status: 'draft' as const,
    };

    expect(await sqlStateOf(db().insert(promotions).values(zeroLength))).toBe(CHECK_VIOLATION);
    expect(
      await sqlStateOf(
        db()
          .insert(promotions)
          .values({ ...zeroLength, endsAt: JANUARY }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('bounds the discount value in the database, not only at the API boundary', async () => {
    const base = {
      name: 'Out of range',
      startsAt: JANUARY,
      endsAt: MARCH,
      status: 'draft' as const,
    };
    const insert = (values: Partial<typeof promotions.$inferInsert>) =>
      db()
        .insert(promotions)
        .values({ ...base, discountType: 'percentage', value: 1000, ...values });

    expect(await sqlStateOf(insert({ value: 0 }))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(insert({ value: -1 }))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(insert({ value: 10_001 }))).toBe(CHECK_VIOLATION);
    // 10 000 basis points is a free product, which is a legitimate promotion; and a fixed
    // discount above the base price is clamped by the pricing function, not rejected here.
    expect(await sqlStateOf(insert({ value: 10_000 }))).toBeUndefined();
    expect(
      await sqlStateOf(insert({ name: 'Large fixed', discountType: 'fixed', value: 10_001 })),
    ).toBeUndefined();
  });
});

describe('promotions under concurrent writers', () => {
  it('lets exactly one of two simultaneous overlapping inserts win', async () => {
    const productId = await insertProduct();
    const promotion = {
      name: 'Race',
      discountType: 'percentage' as const,
      value: 1000,
      startsAt: JANUARY,
      endsAt: MARCH,
      productId,
      status: 'active' as const,
    };

    const results = await Promise.allSettled([
      db()
        .insert(promotions)
        .values({ ...promotion, name: 'Writer A' }),
      db()
        .insert(promotions)
        .values({ ...promotion, name: 'Writer B' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [loser] = results.filter((result) => result.status === 'rejected');
    // Two backends that insert their GiST index tuples at the same instant can wait on each
    // other, and PostgreSQL kills one as a deadlock instead; both outcomes reject the loser.
    expect([EXCLUSION_VIOLATION, DEADLOCK_DETECTED]).toContain(
      await sqlStateOf(Promise.reject(loser!.reason)),
    );
    expect(await db().select({ id: promotions.id }).from(promotions)).toHaveLength(1);
  });
});

describe('products', () => {
  it('rejects a negative price and a negative stock quantity, and accepts zero', async () => {
    expect(await sqlStateOf(insertProduct({ basePriceCents: -1 }))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(insertProduct({ stockQuantity: -1 }))).toBe(CHECK_VIOLATION);

    expect(await insertProduct({ basePriceCents: 0, stockQuantity: 0 })).toBeGreaterThan(0);
  });

  it('round-trips the largest price the number-mode column can carry', async () => {
    const id = await insertProduct({ basePriceCents: Number.MAX_SAFE_INTEGER });

    const [row] = await db()
      .select({ basePriceCents: products.basePriceCents })
      .from(products)
      .where(eq(products.id, id));
    expect(row!.basePriceCents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('keeps the ingestion provenance columns null together, so the upsert guard can order them', async () => {
    expect(await sqlStateOf(insertProduct({ ingestJobId: 7 }))).toBe(CHECK_VIOLATION);
    expect(await sqlStateOf(insertProduct({ ingestSourceOffset: 4096 }))).toBe(CHECK_VIOLATION);

    const manual = await insertProduct();
    const ingested = await insertProduct({ ingestJobId: 7, ingestSourceOffset: 4096 });
    expect(ingested).toBeGreaterThan(manual);
  });

  it('keeps sku unique and carries the ingestion provenance columns', async () => {
    await insertProduct({ sku: 'SKU-DUPLICATE', ingestJobId: 7, ingestSourceOffset: 4096 });
    expect(await sqlStateOf(insertProduct({ sku: 'SKU-DUPLICATE' }))).toBe(UNIQUE_VIOLATION);

    const [row] = await db()
      .select({
        jobId: products.ingestJobId,
        offset: products.ingestSourceOffset,
        version: products.pricingRulesVersion,
      })
      .from(products);
    expect(row).toEqual({ jobId: 7, offset: 4096, version: null });
  });
});

describe('ingestion_jobs', () => {
  const job = {
    vendor: 'acme',
    fileRef: 'uploads/acme-1.csv',
    fileSha256: 'a'.repeat(64),
    fileSizeBytes: 1024,
    chunksTotal: 4,
  };

  it('allows only one unfinished job per vendor', async () => {
    await db().insert(ingestionJobs).values(job);

    expect(
      await sqlStateOf(
        db()
          .insert(ingestionJobs)
          .values({ ...job, fileRef: 'uploads/acme-2.csv', fileSha256: 'b'.repeat(64) }),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await sqlStateOf(
        db()
          .insert(ingestionJobs)
          .values({ ...job, fileSha256: 'c'.repeat(64), status: 'paused' }),
      ),
    ).toBe(UNIQUE_VIOLATION);

    await db().update(ingestionJobs).set({ status: 'completed' });
    await db()
      .insert(ingestionJobs)
      .values({ ...job, fileSha256: 'd'.repeat(64) });

    expect(await db().select({ id: ingestionJobs.id }).from(ingestionJobs)).toHaveLength(2);
  });

  it('never accepts the same file twice, whichever vendor sends it', async () => {
    await db().insert(ingestionJobs).values(job);

    expect(
      await sqlStateOf(
        db()
          .insert(ingestionJobs)
          .values({ ...job, vendor: 'other', fileRef: 'uploads/other.csv' }),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });
});

describe('ingestion_chunks', () => {
  it('keys chunks by job, starts unleased and counts retries apart from failures', async () => {
    const [job] = await db()
      .insert(ingestionJobs)
      .values({
        vendor: 'acme',
        fileRef: 'uploads/acme-1.csv',
        fileSha256: 'a'.repeat(64),
        fileSizeBytes: 1024,
        chunksTotal: 1,
      })
      .returning({ id: ingestionJobs.id });
    const chunk = {
      jobId: job!.id,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 512,
      nextOffset: 0,
    };

    await db().insert(ingestionChunks).values(chunk);
    expect(await sqlStateOf(db().insert(ingestionChunks).values(chunk))).toBe(UNIQUE_VIOLATION);

    const [row] = await db().select().from(ingestionChunks);
    expect(row).toMatchObject({
      leaseUntil: null,
      attempts: 0,
      failures: 0,
      rowsProcessed: 0,
      rowsRejected: 0,
      status: 'pending',
      lastError: null,
    });
  });
});
