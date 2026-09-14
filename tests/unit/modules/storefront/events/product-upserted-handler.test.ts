import { describe, expect, it, vi } from 'vitest';
import { ProductUpsertedHandler } from '@src/modules/storefront/events/product-upserted-handler.js';
import type { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import type { ProductWriteRepository } from '@src/modules/storefront/db/product-write-repository.js';
import { captureLogger } from '../../../capture-logger.js';

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
    writeAll: vi.fn((entries: unknown[]) => Promise.resolve(entries.map(() => true))),
    removeAll: vi.fn((ids: unknown[]) => Promise.resolve(ids.map(() => true))),
  } as unknown as ProductWriteRepository;
  const { logger, lines } = captureLogger();

  return { source, write, logger, lines };
}

describe('ProductUpsertedHandler', () => {
  it('writes every product the announcement named', async () => {
    const { source, write, logger } = collaborators([row(1), row(2)]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1, 2] });

    const [entries] = vi.mocked(write.writeAll).mock.calls[0] ?? [];
    expect(entries).toHaveLength(2);
    expect(entries?.[0]).toMatchObject({ id: 1, sku: 'SKU-1' });
  });

  it('writes the whole batch in one call rather than one round trip per product', async () => {
    const { source, write, logger } = collaborators([row(1), row(2), row(3)]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1, 2, 3] });

    expect(write.writeAll).toHaveBeenCalledTimes(1);
  });

  it('writes with the instant PostgreSQL read, not one the worker made up', async () => {
    const { source, write, logger } = collaborators([row(1)]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1] });

    expect(vi.mocked(write.writeAll).mock.calls[0]?.[1]).toBe(READ_AT);
  });

  it('prices a product at its base until a promotion resolver exists', async () => {
    const { source, write, logger } = collaborators([row(1, { basePriceCents: 7_000 })]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1] });

    // No resolver on this branch, so nothing discounts. The storefront cannot
    // serve any of it yet: `readmodel:ready` is published by the rebuild.
    expect(vi.mocked(write.writeAll).mock.calls[0]?.[0][0]).toMatchObject({
      basePriceCents: 7_000,
      effectivePriceCents: 7_000,
    });
  });

  it('removes an id the announcement named and PostgreSQL no longer holds', async () => {
    const { source, write, logger } = collaborators([row(1)]);

    // Deleted between the publish and this handler: an at-least-once queue
    // makes that ordinary rather than exceptional.
    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1, 2] });

    expect(vi.mocked(write.removeAll).mock.calls[0]?.[0]).toEqual([2]);
    // The token carries the category, so the handler needs no second store to
    // find out which sorted set the deleted row was scored in.
    expect(vi.mocked(write.removeAll).mock.calls[0]?.[1]).toBe(READ_AT);
  });

  it('omits the pricing rules version when the row carries none', async () => {
    const { source, write, logger } = collaborators([row(1, { pricingRulesVersion: null })]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1] });

    expect(vi.mocked(write.writeAll).mock.calls[0]?.[0][0]).not.toHaveProperty(
      'pricingRulesVersion',
    );
  });

  it('reads once for the whole batch rather than once per product', async () => {
    const { source, write, logger } = collaborators([row(1), row(2), row(3)]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1, 2, 3] });

    // One token for the batch is what makes the compare-and-set meaningful:
    // three reads would give three instants and three orderings.
    expect(source.read).toHaveBeenCalledTimes(1);
  });

  it('does not fail the batch when a write is refused by an older token', async () => {
    const { source, write, logger } = collaborators([row(1), row(2)]);
    vi.mocked(write.writeAll).mockResolvedValueOnce([false, true]);

    await expect(
      new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1, 2] }),
    ).resolves.toBeUndefined();
  });

  it('names the products a refusal dropped, so an inversion is not silent', async () => {
    const { source, write, logger, lines } = collaborators([row(1), row(2)]);
    vi.mocked(write.writeAll).mockResolvedValueOnce([false, true]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1, 2] });

    // ADR-0003 clause 4 will not widen the token without a count of the ties it
    // loses, and nothing can count what nothing records.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, productIds: [1], sourceReadAt: READ_AT });
  });

  it('says nothing when every write applied', async () => {
    const { source, write, logger, lines } = collaborators([row(1)]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [1] });

    expect(lines).toEqual([]);
  });

  it('names a refused removal too', async () => {
    const { source, write, logger, lines } = collaborators([]);
    vi.mocked(write.removeAll).mockResolvedValueOnce([false]);

    await new ProductUpsertedHandler(source, write, logger).handle({ productIds: [9] });

    expect(lines[0]).toMatchObject({ productIds: [9] });
  });
});
