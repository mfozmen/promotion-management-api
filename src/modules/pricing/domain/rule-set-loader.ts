import { compileRules } from './compile-rules.js';
import type { CompiledRuleSet } from './dto/compiled-rule-set.js';
import type { PricingRuleRow } from './dto/pricing-rule-row.js';

/** The clock is injected so the 60 s policy is testable without sleeping, and
 *  the in-flight promise is cached so a batch starting cold issues one query,
 *  not one per row. */
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
      // A failed load must not be served for the next 60 s. A rejection that
      // lands after a newer entry was installed clears that entry too; the
      // cost is one extra load, never a wrong price.
      rules.catch(() => {
        cached = undefined;
      });
    }
    return cached.rules;
  };
}
