export type PricingRuleRow = {
  id: number;
  /** The promotion layer shares this table; its rows are skipped, not rejected. */
  type: 'ingestion' | 'promotion';
  name: string;
  conditions: unknown;
  event: unknown;
  priority: number;
  active: boolean;
  updatedAt: Date;
};
