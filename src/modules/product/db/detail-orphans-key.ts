/** Not an index: the name a detail-route orphan is counted under, so a member
 *  that will never come back is not pooled with the transient ghosts a rebuild
 *  makes. One needs a ZREM, the other heals itself. */
export const DETAIL_ORPHANS = 'product:detail:orphans';
