import { describe, expect, it } from 'vitest';
import type { ProductReadRepository } from '@src/modules/product/db/product-read-repository.js';
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
    findAll: () => Promise.resolve([row('1')]),
    ...over,
  } as unknown as ProductReadRepository;
}

describe('ListProductsQuery', () => {
  it('builds the page a client reads, with the total beside it', async () => {
    const result = await new ListProductsQuery(readModel()).execute(input);

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('asks for no category when a shopper names none, and composes no key', async () => {
    const asked: unknown[] = [];
    const model = readModel({
      page: (arg: { category?: string }) => {
        asked.push(arg.category);

        return Promise.resolve(['1']);
      },
      count: (category?: string) => {
        asked.push(category);

        return Promise.resolve(1);
      },
    });

    await new ListProductsQuery(model).execute(input);

    expect(asked).toEqual([undefined, undefined]);
  });

  it('passes the category a shopper named to both reads', async () => {
    const asked: unknown[] = [];
    const model = readModel({
      page: (arg: { category?: string }) => {
        asked.push(arg.category);

        return Promise.resolve([]);
      },
      count: (category?: string) => {
        asked.push(category);

        return Promise.resolve(0);
      },
      findAll: () => Promise.resolve([]),
    });

    await new ListProductsQuery(model).execute({ ...input, category: 'knitwear' });

    expect(asked).toEqual(['knitwear', 'knitwear']);
  });

  it('drops a member whose entry is gone rather than failing the page', async () => {
    const model = readModel({ findAll: () => Promise.resolve([row('1'), {}]) });

    const result = await new ListProductsQuery(model).execute(input);

    expect(result.items).toHaveLength(1);
  });

  it('offsets by the page a shopper asked for', async () => {
    let seen = -1;
    const model = readModel({
      page: ({ offset }: { offset: number }) => {
        seen = offset;

        return Promise.resolve([]);
      },
      count: () => Promise.resolve(0),
      findAll: () => Promise.resolve([]),
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
