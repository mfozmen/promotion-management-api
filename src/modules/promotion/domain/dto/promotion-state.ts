/** What a promotion is doing right now, as opposed to `status`, which is what an admin set. */
export type PromotionState = 'draft' | 'scheduled' | 'live' | 'expired' | 'cancelled';
