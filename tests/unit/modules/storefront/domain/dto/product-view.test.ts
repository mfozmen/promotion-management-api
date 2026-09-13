import { describe, expect, it } from 'vitest';
import { productView } from '@src/modules/storefront/domain/dto/product-view.js';

const stored = {
  id: '7',
  sku: 'SKU-7',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: '10000',
  effectivePriceCents: '10000',
  stockQuantity: '3',
};

describe('productView', () => {
  it('carries the promotion that made the price', () => {
    const view = productView.parse({ ...stored, promotionId: '3', promotionName: 'Winter sale' });

    expect(view.promotion).toEqual({ id: 3, name: 'Winter sale' });
  });

  it('says null where no promotion applies', () => {
    expect(productView.parse(stored).promotion).toBeNull();
  });

  it('refuses a promotion with an id and no name', () => {
    expect(() => productView.parse({ ...stored, promotionId: '3' })).toThrow();
    expect(() => productView.parse({ ...stored, promotionId: '3', promotionName: '' })).toThrow();
  });

  it('reads an empty pair as no promotion, because Redis has no null', () => {
    // ioredis stores null and undefined as '' (ADR-0006).
    const view = productView.parse({ ...stored, promotionId: '', promotionName: '' });

    expect(view.promotion).toBeNull();
  });

  it('still refuses half a pair when the other half is empty', () => {
    expect(() =>
      productView.parse({ ...stored, promotionId: '', promotionName: 'Winter sale' }),
    ).toThrow();
    expect(() => productView.parse({ ...stored, promotionId: '3', promotionName: '' })).toThrow();
  });

  it('refuses a promotion named only with spaces, which renders as no title', () => {
    expect(() =>
      productView.parse({ ...stored, promotionId: '3', promotionName: '   ' }),
    ).toThrow();
  });

  it('refuses an empty price, which is not the same as an absent promotion', () => {
    expect(() => productView.parse({ ...stored, effectivePriceCents: '' })).toThrow();
  });

  it('refuses a discount with no source, which is what tolerating an empty pair let through', () => {
    // ADR-0006: no promotion means no discount.
    expect(() =>
      productView.parse({
        ...stored,
        promotionId: '',
        promotionName: '',
        effectivePriceCents: '9000',
      }),
    ).toThrow();
  });

  it('accepts a promotion whose discount floored to zero, so tightening this refine to `<` fails here', () => {
    // A floored-to-zero discount is a real product, so this rule is `===`.
    const view = productView.parse({ ...stored, promotionId: '3', promotionName: 'Winter sale' });

    expect(view.promotion).toEqual({ id: 3, name: 'Winter sale' });
  });

  it('accepts a discount that names its promotion', () => {
    const view = productView.parse({
      ...stored,
      effectivePriceCents: '9000',
      promotionId: '3',
      promotionName: 'Winter sale',
    });

    expect(view.promotion).toEqual({ id: 3, name: 'Winter sale' });
  });

  it('refuses a name with no id, which would name a discount nothing gave', () => {
    expect(() => productView.parse({ ...stored, promotionName: 'Winter sale' })).toThrow();
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
    expect(() => productView.parse({ ...stored, ...broken })).toThrow();
  });

  it('refuses an entry missing a price rather than serving it at zero', () => {
    const withoutPrice: Record<string, string> = { ...stored };
    delete withoutPrice.effectivePriceCents;

    expect(() => productView.parse(withoutPrice)).toThrow();
  });
});
