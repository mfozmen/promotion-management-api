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

  it.each([
    ['an empty price', { effectivePriceCents: '' }],
    ['a blank price', { effectivePriceCents: ' ' }],
    ['a negative price', { effectivePriceCents: '-500' }],
    ['a hexadecimal price', { effectivePriceCents: '0x10' }],
    ['a fractional price', { effectivePriceCents: '99.5' }],
    ['a price above the base it came from', { effectivePriceCents: '20000' }],
    ['a negative stock count', { stockQuantity: '-1' }],
  ])('refuses %s rather than serving it', (_name, broken) => {
    // `z.coerce.number()` reads '' and ' ' as 0 and '0x10' as 16, so an empty
    // field served the product for nothing, at 200, with the schema's own
    // comment claiming that could not happen.
    expect(() => toProductView({ ...stored, ...broken })).toThrow();
  });

  it('refuses an entry missing a price rather than serving it at zero', () => {
    const withoutPrice: Record<string, string> = { ...stored };
    delete withoutPrice.effectivePriceCents;

    expect(() => toProductView(withoutPrice)).toThrow();
  });
});
