import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import { products, promotions } from '@src/shared/db/schema.js';
import type { Enqueue } from '@src/shared/enqueue.js';
import type { PromotionBoundaries } from '@src/shared/promotion-boundaries.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

interface Recorded {
  events: { name: string; payload: unknown }[];
  scheduled: { promotionId: number; boundary: string }[];
  removed: number[];
}

function recorder(): Recorded & { enqueue: Enqueue; boundaries: PromotionBoundaries } {
  const state: Recorded = { events: [], scheduled: [], removed: [] };
  return {
    ...state,
    enqueue: (name, payload) => {
      state.events.push({ name, payload });
      return Promise.resolve();
    },
    boundaries: {
      schedule: (promotionId, boundary) => {
        state.scheduled.push({ promotionId, boundary });
        return Promise.resolve();
      },
      remove: (promotionId) => {
        state.removed.push(promotionId);
        return Promise.resolve();
      },
    },
  };
}

const hour = 3_600_000;
const future = (ms: number) => new Date(Date.now() + ms).toISOString();
const past = (ms: number) => new Date(Date.now() - ms).toISOString();

let sequence = 0;
const uniqueCategory = () => `Category-${(sequence += 1)}`;

async function newProduct(): Promise<number> {
  const [row] = await db()
    .insert(products)
    .values({
      sku: `SKU-${(sequence += 1)}`,
      name: 'Wool scarf',
      category: uniqueCategory(),
      basePriceCents: 4999,
      stockQuantity: 10,
    })
    .returning();
  return row!.id;
}

const draftBody = () => ({
  name: 'Autumn sale',
  discountType: 'percentage' as const,
  value: 1500,
  startsAt: future(hour),
  endsAt: future(4 * hour),
});

let rec: ReturnType<typeof recorder>;
const app = () => createApp({ db: db(), enqueue: rec.enqueue, boundaries: rec.boundaries });

beforeEach(() => {
  rec = recorder();
});

describe('POST /api/promotions', () => {
  it('creates an active promotion when a target is given, and announces it', async () => {
    const category = uniqueCategory();
    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'active', state: 'scheduled', category });
    expect(rec.events).toEqual([
      { name: 'promotion.changed', payload: { promotionId: res.body.id } },
    ]);
    expect(rec.scheduled).toEqual([
      { promotionId: res.body.id, boundary: 'activate' },
      { promotionId: res.body.id, boundary: 'expire' },
    ]);
  });

  it('creates a draft with no target, and announces nothing', async () => {
    const res = await request(app()).post('/api/promotions').send(draftBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'draft', state: 'draft', productId: null });
    expect(rec.events).toEqual([]);
    expect(rec.scheduled).toEqual([]);
  });

  it('reports a promotion already running as live rather than scheduled', async () => {
    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), startsAt: past(hour), endsAt: future(hour), category: uniqueCategory() });

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('live');
  });

  it('rejects an overlap on the same category with the conflicting id', async () => {
    const category = uniqueCategory();
    const first = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });

    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), name: 'A second sale', category });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROMOTION_OVERLAP');
    expect(res.body.error.details).toEqual({ conflictingPromotionId: first.body.id });
  });

  it('allows two active promotions on one category when their windows do not meet', async () => {
    const category = uniqueCategory();
    await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), startsAt: future(hour), endsAt: future(2 * hour), category });

    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), startsAt: future(3 * hour), endsAt: future(4 * hour), category });

    expect(res.status).toBe(201);
  });

  it.each([
    ['both targets', { productId: 1, category: 'Accessories' }],
    ['an end before its start', { endsAt: future(hour), startsAt: future(2 * hour) }],
    ['an end already past', { startsAt: past(4 * hour), endsAt: past(hour) }],
    ['a percentage above 100 %', { value: 10_001 }],
    ['a zero value', { value: 0 }],
    ['an unknown discount type', { discountType: 'buy-one-get-one' }],
    ['an unknown field', { colour: 'red' }],
  ])('answers 400 for %s', async (_case, patch) => {
    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), ...patch });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(rec.events).toEqual([]);
  });

  it('accepts a start in the past, which means now', async () => {
    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), startsAt: past(hour), endsAt: future(hour), category: uniqueCategory() });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/promotions/:id/assign', () => {
  it('assigns a draft, sets it active and announces it', async () => {
    const created = await request(app()).post('/api/promotions').send(draftBody());
    const category = uniqueCategory();

    const res = await request(app())
      .post(`/api/promotions/${created.body.id}/assign`)
      .send({ category });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', category });
    expect(rec.events).toEqual([
      { name: 'promotion.changed', payload: { promotionId: created.body.id } },
    ]);
    expect(rec.scheduled).toHaveLength(2);
  });

  it('assigns to a product as well as a category', async () => {
    const created = await request(app()).post('/api/promotions').send(draftBody());
    const productId = await newProduct();

    const res = await request(app())
      .post(`/api/promotions/${created.body.id}/assign`)
      .send({ productId });

    expect(res.status).toBe(200);
    expect(res.body.productId).toBe(productId);
  });

  it('answers 409 when the promotion is not a draft', async () => {
    const created = await request(app()).post('/api/promotions').send(draftBody());
    await request(app())
      .post(`/api/promotions/${created.body.id}/assign`)
      .send({ category: uniqueCategory() });
    rec.events.length = 0;

    const res = await request(app())
      .post(`/api/promotions/${created.body.id}/assign`)
      .send({ category: uniqueCategory() });

    expect(res.status).toBe(409);
    expect(rec.events).toEqual([]);
  });

  it('answers 409 for a draft whose window has already passed', async () => {
    // The window is checked by the same guarded UPDATE, on the database clock:
    // a draft that expired while it sat unassigned must not become active.
    const [row] = await db()
      .insert(promotions)
      .values({
        name: 'Stale draft',
        discountType: 'percentage',
        value: 1000,
        startsAt: new Date(Date.now() - 4 * hour),
        endsAt: new Date(Date.now() - hour),
        status: 'draft',
      })
      .returning();

    const res = await request(app())
      .post(`/api/promotions/${row!.id}/assign`)
      .send({ category: uniqueCategory() });

    expect(res.status).toBe(409);
  });

  it('answers 409 with the conflicting id when the assign would overlap', async () => {
    const category = uniqueCategory();
    const running = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });
    const draft = await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app())
      .post(`/api/promotions/${draft.body.id}/assign`)
      .send({ category });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROMOTION_OVERLAP');
    expect(res.body.error.details).toEqual({ conflictingPromotionId: running.body.id });
  });

  it('answers 404 for a promotion that does not exist', async () => {
    const res = await request(app())
      .post('/api/promotions/999999/assign')
      .send({ category: uniqueCategory() });

    expect(res.status).toBe(404);
  });

  it.each([
    ['neither target', {}],
    ['both targets', { productId: 1, category: 'Accessories' }],
  ])('answers 400 for %s', async (_case, body) => {
    const created = await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app()).post(`/api/promotions/${created.body.id}/assign`).send(body);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/promotions/:id/cancel', () => {
  it('cancels an active promotion, drops its boundaries and announces it', async () => {
    const created = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category: uniqueCategory() });
    rec.events.length = 0;

    const res = await request(app()).post(`/api/promotions/${created.body.id}/cancel`).send();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', state: 'cancelled' });
    expect(rec.removed).toEqual([created.body.id]);
    expect(rec.events).toEqual([
      { name: 'promotion.changed', payload: { promotionId: created.body.id } },
    ]);
  });

  it('is idempotent: cancelling twice answers 200 both times', async () => {
    const created = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category: uniqueCategory() });

    const first = await request(app()).post(`/api/promotions/${created.body.id}/cancel`).send();
    const second = await request(app()).post(`/api/promotions/${created.body.id}/cancel`).send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('cancelled');
  });

  it('frees the window it held, so a new promotion can take it', async () => {
    const category = uniqueCategory();
    const first = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });
    await request(app()).post(`/api/promotions/${first.body.id}/cancel`).send();

    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });

    expect(res.status).toBe(201);
  });

  it('answers 404 for a promotion that does not exist', async () => {
    const res = await request(app()).post('/api/promotions/999999/cancel').send();

    expect(res.status).toBe(404);
  });
});

describe('GET /api/promotions', () => {
  it('returns a promotion by id with its derived state', async () => {
    const created = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), startsAt: past(hour), endsAt: future(hour), category: uniqueCategory() });

    const res = await request(app()).get(`/api/promotions/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, state: 'live' });
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await request(app()).get('/api/promotions/999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('filters by category', async () => {
    const category = uniqueCategory();
    await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });
    await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category: uniqueCategory() });

    const res = await request(app()).get('/api/promotions').query({ category });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe(category);
  });

  it('filters by productId and by status', async () => {
    const productId = await newProduct();
    const created = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), productId });

    const byProduct = await request(app()).get('/api/promotions').query({ productId });
    const byStatus = await request(app()).get('/api/promotions').query({ status: 'draft' });

    expect(byProduct.body.items.map((row: { id: number }) => row.id)).toEqual([created.body.id]);
    expect(byStatus.body.items.every((row: { status: string }) => row.status === 'draft')).toBe(true);
  });

  it('rejects an unknown status rather than returning everything', async () => {
    const res = await request(app()).get('/api/promotions').query({ status: 'live-ish' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports an expired promotion as expired', async () => {
    const [row] = await db()
      .insert(promotions)
      .values({
        name: 'Finished sale',
        discountType: 'fixed',
        value: 500,
        startsAt: new Date(Date.now() - 4 * hour),
        endsAt: new Date(Date.now() - hour),
        category: uniqueCategory(),
        status: 'active',
      })
      .returning();

    const res = await request(app()).get(`/api/promotions/${row!.id}`);

    expect(res.body.state).toBe('expired');
  });

  it('is not mounted without a database', async () => {
    const res = await request(createApp()).get('/api/promotions');

    expect(res.status).toBe(404);
  });
});

describe('the write store, not the handler, is what enforces one promotion at a time', () => {
  it('lets exactly one of two concurrent creates win the same window', async () => {
    const category = uniqueCategory();
    const body = { ...draftBody(), category };

    const [a, b] = await Promise.all([
      request(app()).post('/api/promotions').send(body),
      request(app()).post('/api/promotions').send({ ...body, name: 'The other one' }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const stored = await db()
      .select()
      .from(promotions)
      .where(eq(promotions.category, category));
    expect(stored).toHaveLength(1);
  });
});

describe('product-level targets take the same route as category ones', () => {
  it('rejects an overlapping product promotion with the conflicting id', async () => {
    const productId = await newProduct();
    const first = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), productId });

    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), name: 'Second', productId });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ conflictingPromotionId: first.body.id });
  });

  it('rejects an overlapping assign to a product with the conflicting id', async () => {
    const productId = await newProduct();
    const running = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), productId });
    const draft = await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app())
      .post(`/api/promotions/${draft.body.id}/assign`)
      .send({ productId });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ conflictingPromotionId: running.body.id });
  });
});

describe('reading the whole list', () => {
  it('returns every promotion when no filter is given', async () => {
    await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app()).get('/api/promotions');

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('answers 404 for an id that is not a number', async () => {
    const res = await request(app()).get('/api/promotions/not-an-id');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 when cancelling an id that is not a number', async () => {
    const res = await request(app()).post('/api/promotions/not-an-id/cancel').send();

    expect(res.status).toBe(404);
  });
});

describe('two admins assigning one draft at the same moment', () => {
  it('lets exactly one win, because the guarded UPDATE matches one row', async () => {
    // REVIEW.md 3.1 names this race by name. The claim in assign-promotion.ts
    // that the loser "matches no row" is only worth what this test says it is.
    const created = await request(app()).post('/api/promotions').send(draftBody());
    const [first, second] = await Promise.all([
      request(app())
        .post(`/api/promotions/${created.body.id}/assign`)
        .send({ category: uniqueCategory() }),
      request(app())
        .post(`/api/promotions/${created.body.id}/assign`)
        .send({ category: uniqueCategory() }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const [stored] = await db()
      .select()
      .from(promotions)
      .where(eq(promotions.id, created.body.id));
    expect(stored?.status).toBe('active');
    expect(rec.events).toHaveLength(1);
  });

});

describe('an id in the URL that no promotion could have', () => {
  it('answers 404 rather than 500 for an id larger than the column can hold', async () => {
    // Number.isInteger(1e20) is true and the column is bigint, so an unguarded
    // id reaches PostgreSQL and comes back as 22003 — a 500 for a bad URL.
    const res = await request(app()).get('/api/promotions/99999999999999999999');

    expect(res.status).toBe(404);
  });

  it('does not read a hexadecimal id as a decimal one', async () => {
    const res = await request(app()).get('/api/promotions/0x10');

    expect(res.status).toBe(404);
  });
});
