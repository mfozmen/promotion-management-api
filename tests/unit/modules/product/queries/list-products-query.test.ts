import { describe, expect, it } from 'vitest';
import type { ProductReadModel } from '@src/modules/product/db/product-read-model.js';
import { ListProductsQuery } from '@src/modules/product/queries/list-products-query.js';

const row = (id: string, price = '10000') => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  category: 'knitwear',
  basePriceCents: price,
  effectivePriceCents: price,
  stockQuantity: '3',
});

const input = { order: 'asc', page: 1, pageSize: 20 } as const;

function readModel(over: Partial<Record<string, unknown>> = {}) {
  return {
    page: () => Promise.resolve(['1']),
    count: () => Promise.resolve(1),
    hashes: () => Promise.resolve([row('1')]),
    ...over,
  } as unknown as ProductReadModel;
}

describe('ListProductsQuery', () => {
  it('builds the page a client reads, with the total beside it', async () => {
    const result = await new ListProductsQuery(readModel()).execute(input);

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('reads the whole index when no category is asked for', async () => {
    const keys: string[] = [];
    const model = readModel({
      page: (key: string) => {
        keys.push(key);

        return Promise.resolve(['1']);
      },
      count: (key: string) => {
        keys.push(key);

        return Promise.resolve(1);
      },
    });

    await new ListProductsQuery(model).execute(input);

    expect(keys).toEqual(['products:all', 'products:all']);
  });

  it('reads one category when a shopper names it', async () => {
    const keys: string[] = [];
    const model = readModel({
      page: (key: string) => {
        keys.push(key);

        return Promise.resolve([]);
      },
      count: () => Promise.resolve(0),
      hashes: () => Promise.resolve([]),
    });

    await new ListProductsQuery(model).execute({ ...input, category: 'knitwear' });

    expect(keys[0]).toBe('category:knitwear');
  });

  it('drops a member whose entry is gone rather than failing the page', async () => {
    const model = readModel({ hashes: () => Promise.resolve([row('1'), {}]) });

    const result = await new ListProductsQuery(model).execute(input);

    expect(result.items).toHaveLength(1);
  });

  it('offsets by the page a shopper asked for', async () => {
    let seen = -1;
    const model = readModel({
      page: (_key: string, _order: string, offset: number) => {
        seen = offset;

        return Promise.resolve([]);
      },
      count: () => Promise.resolve(0),
      hashes: () => Promise.resolve([]),
    });

    await new ListProductsQuery(model).execute({ ...input, page: 3, pageSize: 20 });

    expect(seen).toBe(40);
  });

  it('lets the store own answer through rather than turning it into a page', async () => {
    const unreachable = new Error('closed');
    const model = readModel({ page: () => Promise.reject(unreachable) });

    const raised = await new ListProductsQuery(model)
      .execute(input)
      .catch((error: unknown) => error);

    expect(raised).toBe(unreachable);
  });
});
