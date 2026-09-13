/** What one sweep looks at: the mark it starts from, the instant it stops at, and
 *  the promotions whose boundaries fall between them. */
export interface BoundaryWindow {
  since: Date;
  windowEnd: Date;
  promotionIds: number[];
}
