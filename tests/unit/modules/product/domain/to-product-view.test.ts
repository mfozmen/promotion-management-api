import { describe, expect, it } from 'vitest';
import { toProductView } from '@src/modules/product/domain/to-product-view.js';

const stored = {
  id: '7',
  sku: 'SKU-7',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: '10000',
  effectivePriceCents: '9000',
  stockQuantity: '3',
};

describe('toProductView', () => {
  it('carries the promotion that made the price', () => {
    const view = toProductView({ ...stored, promotionId: '3', promotionName: 'Winter sale' });

    expect(view.promotion).toEqual({ id: 3, name: 'Winter sale' });
  });

  it('says null where no promotion applies', () => {
    expect(toProductView(stored).promotion).toBeNull();
  });

  it('refuses a promotion with an id and no name', () => {
    // The writer writes the pair together, so half of it is a writer bug. It
    // used to default the name to empty, which renders a shopper a discount
    // attributed to a promotion with no title.
    expect(() => toProductView({ ...stored, promotionId: '3' })).toThrow();
    expect(() => toProductView({ ...stored, promotionId: '3', promotionName: '' })).toThrow();
  });

  it('refuses a name with no id, which would name a discount nothing gave', () => {
    expect(() => toProductView({ ...stored, promotionName: 'Winter sale' })).toThrow();
  });

  it('refuses an entry missing a price rather than serving it at zero', () => {
    const withoutPrice: Record<string, string> = { ...stored };
    delete withoutPrice.effectivePriceCents;

    expect(() => toProductView(withoutPrice)).toThrow();
  });
});
