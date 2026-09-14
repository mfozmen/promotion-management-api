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
