import createError from 'http-errors';
import type { PromotionRepository } from '../db/promotion-repository.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';

export class FindPromotionQuery {
  constructor(private readonly promotions: PromotionRepository) {}

  async execute(id: number): Promise<PromotionView> {
    const promotion = await this.promotions.find(id);

    if (promotion === undefined) throw createError(404, 'No such promotion');

    return promotion;
  }
}
