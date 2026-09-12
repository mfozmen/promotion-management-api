import type { Engine } from 'json-rules-engine';

export type CompiledRuleSet = {
  engine: Engine;
  /** The compiled rules, in evaluation order. A seeded rule carrying the wrong
   *  `type` is filtered out silently, so the caller logs these once per job and
   *  a missing rule is visible in the log rather than only in the prices. */
  ruleIds: readonly number[];
  /** Max `updated_at` of the active ingestion rules, in epoch milliseconds,
   *  the unit `products.pricing_rules_version` stores. */
  pricingRulesVersion: number;
};
