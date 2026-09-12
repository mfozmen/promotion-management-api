import { inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activePromotions, products, promotions } from '../../../../src/shared/db/schema.js';
import { useTestDatabase } from '../../db.js';

const db = useTestDatabase();

let skuCounter = 0;

async function insertProduct() {
  skuCounter += 1;
  const [row] = await db()
    .insert(products)
    .values({
      sku: `ACTIVE-VIEW-${skuCounter}`,
      name: 'Kırmızı Kalem',
      category: 'stationery',
      basePriceCents: 1999,
      stockQuantity: 10,
    })
    .returning({ id: products.id });
  return row!.id;
}

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

describe('active_promotions', () => {
  it('holds the promotion a shopper is entitled to, and none of the four that look like it', async () => {
    const [inWindow, cancelled, expired, future] = await Promise.all([
      insertProduct(),
      insertProduct(),
      insertProduct(),
      insertProduct(),
    ]);

    await db()
      .insert(promotions)
      .values([
        {
          name: 'running now',
          discountType: 'percentage',
          value: 1000,
          startsAt: hoursFromNow(-1),
          endsAt: hoursFromNow(1),
          productId: inWindow,
          status: 'active',
        },
        {
          name: 'never assigned',
          discountType: 'percentage',
          value: 1000,
          startsAt: hoursFromNow(-1),
          endsAt: hoursFromNow(1),
          status: 'draft',
        },
        {
          name: 'called off',
          discountType: 'percentage',
          value: 1000,
          startsAt: hoursFromNow(-1),
          endsAt: hoursFromNow(1),
          productId: cancelled,
          status: 'cancelled',
        },
        {
          name: 'already over',
          discountType: 'percentage',
          value: 1000,
          startsAt: hoursFromNow(-4),
          endsAt: hoursFromNow(-2),
          productId: expired,
          status: 'active',
        },
        {
          name: 'not started',
          discountType: 'percentage',
          value: 1000,
          startsAt: hoursFromNow(2),
          endsAt: hoursFromNow(4),
          productId: future,
          status: 'active',
        },
      ]);

    const rows = await db().select().from(activePromotions);

    expect(rows.map((row) => row.name)).toEqual(['running now']);
    expect(rows[0]).toMatchObject({ productId: inWindow, discountType: 'percentage', value: 1000 });
  });
  it('starts the moment starts_at arrives and stops the moment ends_at does, because the range is half-open', async () => {
    const [startingNow, endingNow] = await Promise.all([insertProduct(), insertProduct()]);

    await db()
      .insert(promotions)
      .values([
        {
          name: 'starting exactly now',
          discountType: 'percentage',
          value: 1000,
          startsAt: sql`now()`,
          endsAt: sql`now() + interval '1 hour'`,
          productId: startingNow,
          status: 'active',
        },
        {
          name: 'ending exactly now',
          discountType: 'percentage',
          value: 1000,
          startsAt: sql`now() - interval '1 hour'`,
          endsAt: sql`now()`,
          productId: endingNow,
          status: 'active',
        },
      ]);

    const rows = await db()
      .select()
      .from(activePromotions)
      .where(inArray(activePromotions.productId, [startingNow, endingNow]));

    expect(rows.map((row) => row.name)).toEqual(['starting exactly now']);
  });
});
