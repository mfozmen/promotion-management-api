import type { Engine } from 'json-rules-engine';

export type CompiledRuleSet = {
  engine: Engine;
  /** The compiled rules, in evaluation order, for the caller to log once per
   *  job — a rule filtered out for its `type` is otherwise invisible. */
  ruleIds: readonly number[];
  /** Max `updated_at` of the active ingestion rules, in epoch milliseconds,
   *  the unit `products.pricing_rules_version` stores. */
  pricingRulesVersion: number;
};
