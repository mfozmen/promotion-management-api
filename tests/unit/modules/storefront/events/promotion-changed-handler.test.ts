import { describe, expect, it, vi } from 'vitest';
import { PromotionChangedHandler } from '@src/modules/storefront/events/promotion-changed-handler.js';
import { captureLogger } from '../../../capture-logger.js';

const view = (over: Record<string, unknown> = {}) => ({
  id: 3,
  name: 'Winter sale',
  discountType: 'percentage' as const,
  value: 2_000,
  startsAt: new Date(),
  endsAt: new Date(),
  productId: null,
  category: null,
  status: 'active' as const,
  state: 'live' as const,
  ...over,
});

function collaborators(promotion: ReturnType<typeof view> | undefined, pages: number[][] = []) {
  const promotions = { find: vi.fn().mockResolvedValue(promotion) };
  const products = {
    idsInCategory: vi.fn(() => Promise.resolve(pages.shift() ?? [])),
  };
  const queue = { publish: vi.fn().mockResolvedValue(undefined) };
  const { logger, lines } = captureLogger();

  return { promotions, products, queue, logger, lines };
}

const handlerOf = (c: ReturnType<typeof collaborators>) =>
  new PromotionChangedHandler(c.promotions, c.products, c.queue, c.logger);

describe('PromotionChangedHandler', () => {
  it('recomputes only the product a product-target promotion names', async () => {
    const c = collaborators(view({ productId: 7 }));

    await handlerOf(c).handle({ promotionId: 3 });

    expect(c.queue.publish).toHaveBeenCalledWith('product.upserted', { productIds: [7] });
    expect(c.products.idsInCategory).not.toHaveBeenCalled();
  });

  it('recomputes a category in pages, enqueuing each rather than scanning inline', async () => {
    const c = collaborators(view({ category: 'knitwear' }), [[1, 2], [5]]);

    await handlerOf(c).handle({ promotionId: 3 });

    // The work moves to the `products` queue: a cancel must not wait behind the
    // sale's own rescan on the urgent queue (ADR-0003).
    expect(vi.mocked(c.queue.publish).mock.calls).toEqual([
      ['product.upserted', { productIds: [1, 2] }],
      ['product.upserted', { productIds: [5] }],
    ]);
  });

  it('pages by the last id it saw rather than by an offset', async () => {
    const c = collaborators(view({ category: 'knitwear' }), [[1, 2], [5]]);

    await handlerOf(c).handle({ promotionId: 3 });

    expect(vi.mocked(c.products.idsInCategory).mock.calls).toEqual([
      ['knitwear', 0],
      ['knitwear', 2],
      ['knitwear', 5],
    ]);
  });

  it('re-reads the row, so a job firing against a cancelled promotion still recomputes', async () => {
    const c = collaborators(view({ productId: 7, status: 'cancelled', state: 'cancelled' }));

    await handlerOf(c).handle({ promotionId: 3 });

    // A boundary job means re-read, never activate: the recompute publishes
    // whatever the row now says, which for a cancel is the base price.
    expect(c.queue.publish).toHaveBeenCalledWith('product.upserted', { productIds: [7] });
  });

  it('says so and does nothing when the promotion has no target', async () => {
    const c = collaborators(view());

    await handlerOf(c).handle({ promotionId: 3 });

    expect(c.queue.publish).not.toHaveBeenCalled();
    expect(c.lines[0]).toMatchObject({ level: 40, promotionId: 3 });
  });

  it('says so and does nothing when the promotion is gone', async () => {
    const c = collaborators(undefined);

    await handlerOf(c).handle({ promotionId: 3 });

    expect(c.queue.publish).not.toHaveBeenCalled();
    expect(c.lines[0]).toMatchObject({ promotionId: 3 });
  });
});
