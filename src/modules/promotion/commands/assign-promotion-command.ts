import type { PromotionRepository } from '../db/promotion-repository.js';
import type { PromotionAnnouncer } from '../domain/promotion-announcer.js';
import type { AssignPromotion } from '../domain/dto/assign-promotion-input.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';
import { promotionWriteError } from './promotion-write-error.js';

export class AssignPromotionCommand {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly announcer: PromotionAnnouncer,
  ) {}

  async execute(id: number, target: AssignPromotion): Promise<PromotionView> {
    const outcome = await this.promotions.assign(id, target);

    if (!outcome.ok) throw promotionWriteError(outcome);

    await this.announcer.announce(outcome.promotion, outcome.now);

    return outcome.promotion;
  }
}
