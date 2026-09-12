export type PricingRuleRow = {
  id: number;
  /** The promotion layer keeps its rules in the same table and its events mean
   *  nothing here, so they are skipped rather than parsed and rejected. */
  type: 'ingestion' | 'promotion';
  name: string;
  conditions: unknown;
  event: unknown;
  priority: number;
  active: boolean;
  updatedAt: Date;
};
