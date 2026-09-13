import { describe, expect, it, vi } from 'vitest';
import { ProductUpsertedHandler } from '@src/modules/storefront/events/product-upserted-handler.js';
import type { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import type { ProductWriteRepository } from '@src/modules/storefront/db/product-write-repository.js';

const READ_AT = '1789380000000000';

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  sku: `SKU-${String(id)}`,
  name: `Product ${String(id)}`,
  category: 'knitwear',
  basePriceCents: 10_000,
  stockQuantity: 5,
  pricingRulesVersion: 1_789_238_046,
  ...over,
});

function collaborators(rows: ReturnType<typeof row>[]) {
  const source = {
    read: vi.fn().mockResolvedValue({ rows, sourceReadAt: READ_AT }),
  } as unknown as ProductSourceRepository;
  const write = {
    write: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
  } as unknown as ProductWriteRepository;

  return { source, write };
}

describe('ProductUpsertedHandler', () => {
  it('writes every product the announcement named', async () => {
    const { source, write } = collaborators([row(1), row(2)]);

    await new ProductUpsertedHandler(source, write).handle({ productIds: [1, 2] });

    expect(write.write).toHaveBeenCalledTimes(2);
    expect(vi.mocked(write.write).mock.calls[0]?.[0]).toMatchObject({ id: 1, sku: 'SKU-1' });
  });

  it('writes with the instant PostgreSQL read, not one the worker made up', async () => {
    const { source, write } = collaborators([row(1)]);

    await new ProductUpsertedHandler(source, write).handle({ productIds: [1] });

    expect(vi.mocked(write.write).mock.calls[0]?.[1]).toBe(READ_AT);
  });

  it('prices a product at its base until a promotion resolver exists', async () => {
    const { source, write } = collaborators([row(1, { basePriceCents: 7_000 })]);

    await new ProductUpsertedHandler(source, write).handle({ productIds: [1] });

    // No resolver on this branch, so nothing discounts. The storefront cannot
    // serve any of it yet: `readmodel:ready` is published by the rebuild.
    expect(vi.mocked(write.write).mock.calls[0]?.[0]).toMatchObject({
      basePriceCents: 7_000,
      effectivePriceCents: 7_000,
    });
  });

  it('removes an id the announcement named and PostgreSQL no longer holds', async () => {
    const { source, write } = collaborators([row(1)]);

    // Deleted between the publish and this handler: an at-least-once queue
    // makes that ordinary rather than exceptional.
    await new ProductUpsertedHandler(source, write).handle({ productIds: [1, 2] });

    expect(write.remove).toHaveBeenCalledTimes(1);
    expect(vi.mocked(write.remove).mock.calls[0]?.[0]).toBe(2);
    // The token carries the category, so the handler needs no second store to
    // find out which sorted set the deleted row was scored in.
    expect(vi.mocked(write.remove).mock.calls[0]?.[1]).toBe(READ_AT);
  });

  it('omits the pricing rules version when the row carries none', async () => {
    const { source, write } = collaborators([row(1, { pricingRulesVersion: null })]);

    await new ProductUpsertedHandler(source, write).handle({ productIds: [1] });

    expect(vi.mocked(write.write).mock.calls[0]?.[0]).not.toHaveProperty('pricingRulesVersion');
  });

  it('reads once for the whole batch rather than once per product', async () => {
    const { source, write } = collaborators([row(1), row(2), row(3)]);

    await new ProductUpsertedHandler(source, write).handle({ productIds: [1, 2, 3] });

    // One token for the batch is what makes the compare-and-set meaningful:
    // three reads would give three instants and three orderings.
    expect(source.read).toHaveBeenCalledTimes(1);
  });

  it('does not fail the batch when a write is refused by an older token', async () => {
    const { source, write } = collaborators([row(1), row(2)]);
    vi.mocked(write.write).mockResolvedValueOnce(false);

    await expect(
      new ProductUpsertedHandler(source, write).handle({ productIds: [1, 2] }),
    ).resolves.toBeUndefined();

    expect(write.write).toHaveBeenCalledTimes(2);
  });
});
