import type { CompiledRuleSet } from './compiled-rule-set.js';
import type { PricingRuleRow } from './dto/pricing-rule-row.js';
import { RuleCompiler } from './rule-compiler.js';

/** The in-flight promise is cached: a batch starting cold issues one query, not one per row. */
export class RuleSetLoader {
  private cached: { expiresAt: number; rules: Promise<CompiledRuleSet> } | undefined;
  private readonly source: () => Promise<readonly PricingRuleRow[]>;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly compiler: RuleCompiler;

  constructor(options: {
    source: () => Promise<readonly PricingRuleRow[]>;
    now: () => number;
    ttlMs?: number;
    compiler?: RuleCompiler;
  }) {
    this.source = options.source;
    this.now = options.now;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.compiler = options.compiler ?? new RuleCompiler();
  }

  load(): Promise<CompiledRuleSet> {
    if (this.cached === undefined || this.now() >= this.cached.expiresAt) {
      const rules = this.source().then((rows) => this.compiler.compile(rows));
      this.cached = { expiresAt: this.now() + this.ttlMs, rules };
      // A rejection landing after a newer entry clears that too: one extra load, never a wrong price.
      rules.catch(() => {
        this.cached = undefined;
      });
    }
    return this.cached.rules;
  }
}
