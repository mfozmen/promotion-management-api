/** A `pricing_rules` row as the promotion layer reads it. The pricing module
 *  has its own shape for the same table: the two layers share storage and
 *  nothing else, and neither imports the other (ADR-0005). */
export type PromotionRuleRow = {
  id: number;
  type: 'ingestion' | 'promotion';
  name: string;
  conditions: unknown;
  event: unknown;
  priority: number;
  active: boolean;
  updatedAt: Date;
};
