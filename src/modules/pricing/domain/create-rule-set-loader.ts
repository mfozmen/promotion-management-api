import { compileRules } from './compile-rules.js';
import type { CompiledRuleSet } from './dto/compiled-rule-set.js';
import type { PricingRuleRow } from './dto/pricing-rule-row.js';

/** The in-flight promise is cached: a batch starting cold issues one query, not one per row. */
export function createRuleSetLoader(options: {
  load: () => Promise<readonly PricingRuleRow[]>;
  now: () => number;
  ttlMs?: number;
}): () => Promise<CompiledRuleSet> {
  const ttlMs = options.ttlMs ?? 60_000;
  let cached: { expiresAt: number; rules: Promise<CompiledRuleSet> } | undefined;

  return () => {
    if (cached === undefined || options.now() >= cached.expiresAt) {
      const rules = options.load().then(compileRules);
      cached = { expiresAt: options.now() + ttlMs, rules };
      // A rejection landing after a newer entry clears that too: one extra load, never a wrong price.
      rules.catch(() => {
        cached = undefined;
      });
    }
    return cached.rules;
  };
}
