import type { Engine, EngineResult } from 'json-rules-engine';

import type { VendorRowFacts } from './dto/vendor-row-facts.js';

/**
 * The engine and the one-run-at-a-time rule that owns it. `json-rules-engine` keeps per-run
 * state on the engine, so two overlapping runs clobber each other; serialising here rather
 * than in a caller means no caller can be holding it wrong. ADR-0005.
 */
export class CompiledRuleSet {
  private queue: Promise<unknown> = Promise.resolve();
  private spentBy: Error | undefined;

  constructor(
    private readonly engine: Engine,
    readonly ruleIds: readonly number[],
    /** Epoch ms, the unit `products.pricing_rules_version` stores. */
    readonly pricingRulesVersion: number,
  ) {}

  run(facts: VendorRowFacts): Promise<EngineResult> {
    // Checked inside the continuation too: a row queued before the failure lands would
    // otherwise run on a spent engine.
    const run = this.queue.then(() =>
      this.spentBy ? Promise.reject(this.spentBy) : this.engine.run(facts),
    );
    this.queue = run.catch((error: unknown) => {
      this.spentBy = error instanceof Error ? error : new Error(String(error));
    });
    return run;
  }
}
