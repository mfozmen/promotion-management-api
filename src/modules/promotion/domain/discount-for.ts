import { discounts } from './discounts.js';
import type { Discount } from './dto/discount.js';

export function discountFor(discountType: string): Discount | undefined {
  return Object.hasOwn(discounts, discountType)
    ? discounts[discountType as keyof typeof discounts]
    : undefined;
}
