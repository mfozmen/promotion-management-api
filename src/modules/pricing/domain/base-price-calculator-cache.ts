import type { PricingRuleRow } from './dto/pricing-rule-row.js';
import { BasePriceCalculator } from './base-price-calculator.js';

export class BasePriceCalculatorCache {
  private cached: { expiresAt: number; rules: Promise<BasePriceCalculator> } | undefined;
  private readonly source: () => Promise<readonly PricingRuleRow[]>;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: {
    source: () => Promise<readonly PricingRuleRow[]>;
    now: () => number;
    ttlMs?: number;
  }) {
    this.source = options.source;
    this.now = options.now;
    this.ttlMs = options.ttlMs ?? 60_000;
  }

  current(): Promise<BasePriceCalculator> {
    if (this.cached === undefined || this.now() >= this.cached.expiresAt) {
      const rules = this.source().then((rows) => BasePriceCalculator.fromRules(rows));
      this.cached = { expiresAt: this.now() + this.ttlMs, rules };
      // A failed load is never served; clearing a newer entry costs one reload.
      rules.catch(() => {
        this.cached = undefined;
      });
    }
    return this.cached.rules;
  }
}
