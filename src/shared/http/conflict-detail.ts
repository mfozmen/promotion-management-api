/**
 * What a conflict tells the caller beyond its message: the id of the row that
 * already holds what they asked for.
 *
 * Deliberately separate from `ValidationDetail`, which promises the caller their
 * own field names and nothing read from a row. This is read from a row, and it is
 * the one exception the case study asks for — an admin refused a promotion needs
 * to know which one to cancel. `null` when the conflicting row was gone by the
 * time the lookup ran.
 */
export interface ConflictDetail {
  conflictingPromotionId: number | null;
}
