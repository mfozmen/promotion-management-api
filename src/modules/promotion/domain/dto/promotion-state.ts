/**
 * What a promotion is doing right now, as opposed to `status`, which is what an
 * admin set. The two differ because `active` only says the row has a target and
 * is not cancelled; whether it is running depends on the clock.
 *
 * Always computed in SQL on the database clock, never re-derived here.
 */
export type PromotionState = 'draft' | 'scheduled' | 'live' | 'expired' | 'cancelled';
