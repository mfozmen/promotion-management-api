import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { appDeps } from '@tests/app-deps.js';
import { createApp } from '@src/app.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { PromotionScheduler } from '@src/modules/promotion/domain/promotion-scheduler.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

interface Recorded {
  events: { name: string; payload: unknown }[];
  scheduled: { promotionId: number; boundary: string; delay: number }[];
  removed: number[];
}

function recorder(): Recorded & {
  queue: { publish: (name: string, payload: unknown) => Promise<unknown> };
  scheduler: PromotionScheduler;
} {
  const state: Recorded = { events: [], scheduled: [], removed: [] };
  // The real scheduler over a fake queue: the job id and the delay are exercised.
  const scheduler = new PromotionScheduler({
    publish: (_name, payload, options) => {
      const jobId = String(options?.jobId ?? '');
      const boundary = jobId.endsWith(':activate') ? 'activate' : 'expire';
      state.scheduled.push({
        promotionId: (payload as { promotionId: number }).promotionId,
        boundary,
        delay: Number(options?.delay ?? 0),
      });
      return Promise.resolve({ id: jobId } as never);
    },
    remove: (_name, jobId) => {
      const id = Number(jobId.split(':')[1]);
      if (!state.removed.includes(id)) state.removed.push(id);
      return Promise.resolve(1);
    },
  });
  return {
    ...state,
    queue: {
      publish: (name: string, payload: unknown) => {
        state.events.push({ name, payload });

        return Promise.resolve();
      },
    },
    scheduler,
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
const app = () => createApp(appDeps({ db: db(), queue: rec.queue, scheduler: rec.scheduler }));

beforeEach(() => {
  rec = recorder();
});

describe('POST /api/promotions', () => {
  it('creates an active promotion when a target is given, and schedules it', async () => {
    const category = uniqueCategory();
    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'active', state: 'scheduled', category });
    // No recompute now: the sale starts later, so the `activate` job carries it.
    // Publishing here would scan the whole category to change no price.
    expect(rec.events).toEqual([]);
    // Order is not asserted: they are scheduled concurrently, so it is an accident.
    const sorted = [...rec.scheduled].sort((a, b) => a.boundary.localeCompare(b.boundary));
    expect(sorted.map((s) => s.boundary)).toEqual(['activate', 'expire']);
    expect(sorted.every((s) => s.promotionId === res.body.id)).toBe(true);
    // `now()` comes back as text, so computing the delay from it can throw.
    expect(sorted[0]?.delay).toBeGreaterThan(0);
    expect(sorted[1]?.delay).toBeGreaterThan(sorted[0]!.delay);
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
      .send({
        ...draftBody(),
        startsAt: past(hour),
        endsAt: future(hour),
        category: uniqueCategory(),
      });

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('live');
  });

  it('rejects an overlap on the same category without naming the promotion in place', async () => {
    const category = uniqueCategory();
    const first = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });

    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), name: 'A second sale', category });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      message: 'An active promotion already covers that target for this window',
    });
    // The conflicting promotion is named nowhere.
    expect(JSON.stringify(res.body)).not.toContain(String(first.body.id));
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
    expect(res.body.error.message).toMatch(/^Invalid request /);
    expect(rec.events).toEqual([]);
  });

  it('accepts a start in the past, which means now', async () => {
    const res = await request(app())
      .post('/api/promotions')
      .send({
        ...draftBody(),
        startsAt: past(hour),
        endsAt: future(hour),
        category: uniqueCategory(),
      });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/promotions/:id/assign', () => {
  it('assigns a draft, sets it active and schedules it', async () => {
    const created = await request(app()).post('/api/promotions').send(draftBody());
    const category = uniqueCategory();

    const res = await request(app())
      .post(`/api/promotions/${created.body.id}/assign`)
      .send({ category });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', category });
    // The draft's window opens later, so both boundaries are scheduled and
    // nothing is recomputed yet.
    expect(rec.events).toEqual([]);
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

  it('answers 409 without naming the promotion in the way when the assign would overlap', async () => {
    const category = uniqueCategory();
    const running = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), category });
    const draft = await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app())
      .post(`/api/promotions/${draft.body.id}/assign`)
      .send({ category });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      message: 'An active promotion already covers that target for this window',
    });
    expect(JSON.stringify(res.body)).not.toContain(String(running.body.id));
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
      .send({
        ...draftBody(),
        startsAt: past(hour),
        endsAt: future(hour),
        category: uniqueCategory(),
      });

    const res = await request(app()).get(`/api/promotions/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, state: 'live' });
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await request(app()).get('/api/promotions/999999');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('No such promotion');
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
    expect(byStatus.body.items.every((row: { status: string }) => row.status === 'draft')).toBe(
      true,
    );
  });

  it('rejects an unknown status rather than returning everything', async () => {
    const res = await request(app()).get('/api/promotions').query({ status: 'live-ish' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/^Invalid request /);
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
});

describe('the write store, not the handler, is what enforces one promotion at a time', () => {
  it('lets exactly one of two concurrent creates win the same window', async () => {
    const category = uniqueCategory();
    const body = { ...draftBody(), category };

    const [a, b] = await Promise.all([
      request(app()).post('/api/promotions').send(body),
      request(app())
        .post('/api/promotions')
        .send({ ...body, name: 'The other one' }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const stored = await db().select().from(promotions).where(eq(promotions.category, category));
    expect(stored).toHaveLength(1);
  });
});

describe('product-level targets take the same route as category ones', () => {
  it('rejects an overlapping product promotion without naming the one it collided with', async () => {
    const productId = await newProduct();
    const first = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), productId });

    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), name: 'Second', productId });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      message: 'An active promotion already covers that target for this window',
    });
    expect(JSON.stringify(res.body)).not.toContain(String(first.body.id));
  });

  it('rejects an overlapping assign without naming the promotion in place', async () => {
    const productId = await newProduct();
    const running = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), productId });
    const draft = await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app())
      .post(`/api/promotions/${draft.body.id}/assign`)
      .send({ productId });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      message: 'An active promotion already covers that target for this window',
    });
    expect(JSON.stringify(res.body)).not.toContain(String(running.body.id));
  });
});

describe('reading the whole list', () => {
  it('returns every promotion when no filter is given', async () => {
    await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app()).get('/api/promotions');

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('answers 400 for an id that is not a number, as the storefront does', async () => {
    const res = await request(app()).get('/api/promotions/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Invalid request params');
  });

  it('answers 400 when cancelling an id that is not a number', async () => {
    const res = await request(app()).post('/api/promotions/not-an-id/cancel').send();

    expect(res.status).toBe(400);
  });
});

describe('two admins assigning one draft at the same moment', () => {
  it('lets exactly one win, because the guarded UPDATE matches one row', async () => {
    // The claim that the loser "matches no row" is worth what this test says.
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

    const [stored] = await db().select().from(promotions).where(eq(promotions.id, created.body.id));
    expect(stored?.status).toBe('active');
    // The winner schedules its boundaries; neither admin's sale is running yet.
    expect(rec.events).toEqual([]);
  });
});

describe('an id in the URL that no promotion could have', () => {
  it('answers 400 rather than 500 for an id larger than the column can hold', async () => {
    // Number.isInteger(1e20) is true and the column is bigint, so an unguarded
    // id reaches PostgreSQL and comes back as 22003 — a 500 for a bad URL.
    const res = await request(app()).get('/api/promotions/99999999999999999999');

    expect(res.status).toBe(400);
  });

  it('does not read a hexadecimal id as a decimal one', async () => {
    const res = await request(app()).get('/api/promotions/0x10');

    expect(res.status).toBe(400);
  });
});

describe('the admin list is bounded and pages by keyset', () => {
  it('returns at most `limit` rows and continues after the last id', async () => {
    const category = uniqueCategory();
    const ids: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const created = await request(app())
        .post('/api/promotions')
        .send({
          ...draftBody(),
          name: `Sale ${i}`,
          category,
          startsAt: future((i + 1) * 10 * hour),
          endsAt: future((i + 1) * 10 * hour + hour),
        });
      ids.push(created.body.id);
    }

    const first = await request(app()).get('/api/promotions').query({ category, limit: 2 });
    const next = await request(app())
      .get('/api/promotions')
      .query({ category, limit: 2, after: first.body.items[1].id });

    expect(first.body.items.map((row: { id: number }) => row.id)).toEqual(ids.slice(0, 2));
    expect(next.body.items.map((row: { id: number }) => row.id)).toEqual(ids.slice(2));
  });

  it('rejects a limit above the cap rather than serving the whole table', async () => {
    const res = await request(app()).get('/api/promotions').query({ limit: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/^Invalid request /);
  });
});

describe('a promotion aimed at a product that does not exist', () => {
  it('answers 404 on create rather than paging someone with a 500', async () => {
    // The foreign key raises 23503. Before it was caught, an admin's typo in
    // productId reached the generic handler as INTERNAL.
    const res = await request(app())
      .post('/api/promotions')
      .send({ ...draftBody(), productId: 424242 });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('No such product');
  });

  it('answers 404 on assign too', async () => {
    const created = await request(app()).post('/api/promotions').send(draftBody());

    const res = await request(app())
      .post(`/api/promotions/${created.body.id}/assign`)
      .send({ productId: 424242 });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('No such product');
  });
});

describe('a promotion that is already running when it is created', () => {
  it('schedules only the expiry, because the create event is the activation', async () => {
    // Scheduling an activate with delay 0 would put a second promotion.changed on
    // the queue milliseconds behind the first, and each rescans the whole category.
    const res = await request(app())
      .post('/api/promotions')
      .send({
        ...draftBody(),
        startsAt: past(hour),
        endsAt: future(hour),
        category: uniqueCategory(),
      });

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('live');
    expect(rec.scheduled.map((s) => s.boundary)).toEqual(['expire']);
    expect(rec.events).toHaveLength(1);
  });
});
