import type { PromotionRepository } from '../db/promotion-repository.js';
import type { ListPromotionsInput } from '../domain/dto/list-promotions-input.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';

export class ListPromotionsQuery {
  constructor(private readonly promotions: PromotionRepository) {}

  async execute(input: ListPromotionsInput): Promise<{ items: PromotionView[] }> {
    return { items: await this.promotions.list(input) };
  }
}
