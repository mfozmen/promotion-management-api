import type { Engine } from 'json-rules-engine';

export type CompiledRuleSet = {
  engine: Engine;
  ruleIds: readonly number[];
  /** Epoch ms, the unit `products.pricing_rules_version` stores. */
  pricingRulesVersion: number;
};
