import type { DiscountType } from '../../../promotion/domain/dto/discount-type.js';

export interface PromotionCandidate {
  id: number;
  name: string;
  discountType: DiscountType;
  value: number;
}
