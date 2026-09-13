export type PricingRuleRow = {
  id: number;
  type: 'ingestion' | 'promotion';
  name: string;
  conditions: unknown;
  event: unknown;
  priority: number;
  active: boolean;
  updatedAt: Date;
};
