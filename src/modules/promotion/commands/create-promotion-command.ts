import type { PromotionRepository } from '../db/promotion-repository.js';
import type { PromotionAnnouncer } from '../domain/promotion-announcer.js';
import type { CreatePromotion } from '../domain/dto/create-promotion-input.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';
import { promotionWriteError } from './promotion-write-error.js';

export class CreatePromotionCommand {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly announcer: PromotionAnnouncer,
  ) {}

  async execute(input: CreatePromotion): Promise<PromotionView> {
    const outcome = await this.promotions.insert(input);

    if (!outcome.ok) throw promotionWriteError(outcome);

    await this.announcer.announce(outcome.promotion, outcome.now);

    return outcome.promotion;
  }
}
