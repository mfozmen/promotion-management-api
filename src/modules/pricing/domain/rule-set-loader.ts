import type { CompiledRuleSet } from './dto/compiled-rule-set.js';
import type { PricingRuleRow } from './dto/pricing-rule-row.js';
import { RuleCompiler } from './rule-compiler.js';

/** The in-flight promise is cached: a batch starting cold issues one query, not one per row. */
export class RuleSetLoader {
  private cached: { expiresAt: number; rules: Promise<CompiledRuleSet> } | undefined;

  constructor(
    private readonly load: () => Promise<readonly PricingRuleRow[]>,
    private readonly now: () => number,
    private readonly ttlMs = 60_000,
    private readonly compiler = new RuleCompiler(),
  ) {}

  current(): Promise<CompiledRuleSet> {
    if (this.cached === undefined || this.now() >= this.cached.expiresAt) {
      const rules = this.load().then((rows) => this.compiler.compile(rows));
      this.cached = { expiresAt: this.now() + this.ttlMs, rules };
      // A rejection landing after a newer entry clears that too: one extra load, never a wrong price.
      rules.catch(() => {
        this.cached = undefined;
      });
    }
    return this.cached.rules;
  }
}
