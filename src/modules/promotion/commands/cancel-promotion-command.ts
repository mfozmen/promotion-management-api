import type { PromotionRepository } from '../db/promotion-repository.js';
import type { PromotionAnnouncer } from '../domain/promotion-announcer.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';
import { promotionWriteError } from './promotion-write-error.js';

export class CancelPromotionCommand {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly announcer: PromotionAnnouncer,
  ) {}

  async execute(id: number): Promise<PromotionView> {
    const outcome = await this.promotions.cancel(id);

    if (!outcome.ok) throw promotionWriteError(outcome);

    // Only when this call is what cancelled it: a repeat is a success the caller
    // asked for, and re-announcing would fan out over the category again.
    if (outcome.changed) await this.announcer.announceCancellation(id);

    return outcome.promotion;
  }
}
