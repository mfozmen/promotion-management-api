import { describe, expect, it } from 'vitest';
import createError from 'http-errors';
import type { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { FindProductQuery } from '@src/modules/storefront/queries/find-product-query.js';

const stored = {
  id: '7',
  sku: 'SKU-7',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: '10000',
  effectivePriceCents: '10000',
  stockQuantity: '3',
};

const products = (
  find: () => Promise<Record<string, string> | undefined>,
  isListed: () => Promise<boolean> = () => Promise.resolve(false),
) => ({ find, isListed }) as unknown as ProductReadRepository;

describe('FindProductQuery', () => {
  it('answers the product a shopper asked for, mapped to the view', async () => {
    const view = await new FindProductQuery(products(() => Promise.resolve(stored))).execute(7);

    expect(view).toMatchObject({ id: 7, sku: 'SKU-7', promotion: null });
  });

  it('owns the miss: a product no index lists is its 404', async () => {
    const raised = await new FindProductQuery(products(() => Promise.resolve(undefined)))
      .execute(7)
      .catch((error: unknown) => error);

    // The route decides nothing; if this were undefined the route would have
    // to branch, which is the shape this fold exists to remove.
    expect((raised as createError.HttpError).status).toBe(404);
  });

  it('answers 503 for a product the index still lists, so a crawler caches no 404', async () => {
    const raised = await new FindProductQuery(
      products(
        () => Promise.resolve(undefined),
        () => Promise.resolve(true),
      ),
    )
      .execute(7)
      .catch((error: unknown) => error);

    expect((raised as createError.HttpError).status).toBe(503);
  });

  it('lets the store own answer through, so an outage is not a 404', async () => {
    const unreachable = new (class extends Error {})('closed');
    const raised = await new FindProductQuery(products(() => Promise.reject(unreachable)))
      .execute(7)
      .catch((error: unknown) => error);

    expect(raised).toBe(unreachable);
  });

  it('refuses a row the writer got wrong rather than serving it', async () => {
    const raised = await new FindProductQuery(
      products(() => Promise.resolve({ id: '7', name: 'no prices here' })),
    )
      .execute(7)
      .catch((error: unknown) => error);

    expect(createError.isHttpError(raised)).toBe(false);
  });
});
