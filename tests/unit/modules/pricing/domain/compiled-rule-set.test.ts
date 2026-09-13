import { Engine } from 'json-rules-engine';
import { describe, expect, it } from 'vitest';
import { CompiledRuleSet } from '@src/modules/pricing/domain/compiled-rule-set.js';
import type { VendorRowFacts } from '@src/modules/pricing/domain/dto/vendor-row-facts.js';

const row: VendorRowFacts = { category: 'Electronics', vendorPriceCents: 80_000, stockQuantity: 3 };

const firing = (name: string, priority: number) => ({
  name,
  priority,
  conditions: { all: [{ fact: 'category', operator: 'equal', value: 'Electronics' }] },
  event: { type: 'adjustCents', params: { value: 0 } },
});

function ruleSet(build: (engine: Engine) => void): CompiledRuleSet {
  const engine = new Engine();
  build(engine);
  return new CompiledRuleSet(engine, [1], 1);
}

// The engine keeps per-run state on itself, so a second run started mid-flight marks it
// finished under the first one's feet and the first returns short. The queue is the defence,
// and it lives here so that no caller can hold it wrong.
describe('CompiledRuleSet', () => {
  it('serialises overlapping runs rather than letting them clobber each other', async () => {
    let calls = 0;
    const rules = ruleSet((engine) => {
      // First evaluation yields to the event loop, so a run started meanwhile finishes first.
      engine.addFact('slow', () =>
        calls++ === 0
          ? new Promise((resolve) => setImmediate(() => resolve(true)))
          : Promise.resolve(true),
      );
      engine.addRule(firing('markup', 10));
      engine.addRule({
        name: 'slow',
        priority: 1000,
        conditions: { all: [{ fact: 'slow', operator: 'equal', value: true }] },
        event: { type: 'adjustCents', params: { value: 0 } },
      });
    });

    const results = await Promise.all([rules.run(row), rules.run(row)]);

    expect(results.map((result) => result.events.length)).toEqual([2, 2]);
  });

  it('keeps rejecting after a failed run rather than serving a half-used engine', async () => {
    let failing = true;
    const rules = ruleSet((engine) => {
      engine.addFact('flaky', () => {
        if (!failing) return Promise.resolve(1);
        failing = false;
        return Promise.reject(new Error('fact blew up'));
      });
      engine.addRule({
        name: 'flaky',
        priority: 1000,
        conditions: { all: [{ fact: 'flaky', operator: 'equal', value: 1 }] },
        event: { type: 'adjustCents', params: { value: 0 } },
      });
    });

    await expect(rules.run(row)).rejects.toThrow('fact blew up');
    await expect(rules.run(row)).rejects.toThrow('fact blew up');
  });

  it('rejects the runs already queued when the one ahead of them fails', async () => {
    let failing = true;
    const rules = ruleSet((engine) => {
      engine.addFact('flaky', () => {
        if (!failing) return Promise.resolve(1);
        failing = false;
        return Promise.reject(new Error('fact blew up'));
      });
      engine.addRule({
        name: 'flaky',
        priority: 1000,
        conditions: { all: [{ fact: 'flaky', operator: 'equal', value: 1 }] },
        event: { type: 'adjustCents', params: { value: 0 } },
      });
    });

    // Queued before the first run's failure is observed, so a check made only when the call
    // arrives would let these through onto the spent engine.
    const outcomes = await Promise.allSettled([rules.run(row), rules.run(row), rules.run(row)]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('normalises a rejection that is not an Error, so the set stays spent', async () => {
    const rules = ruleSet((engine) => {
      engine.addFact('bad', () => Promise.reject('a string'));
      engine.addRule({
        name: 'bad',
        priority: 1000,
        conditions: { all: [{ fact: 'bad', operator: 'equal', value: 1 }] },
        event: { type: 'adjustCents', params: { value: 0 } },
      });
    });

    await expect(rules.run(row)).rejects.toBeDefined();
    await expect(rules.run(row)).rejects.toThrow('a string');
  });

  it('carries the rule ids and the version the compiler gave it', () => {
    const rules = new CompiledRuleSet(new Engine(), [7, 9], 1_700_000_000_000);

    expect(rules.ruleIds).toEqual([7, 9]);
    expect(rules.pricingRulesVersion).toBe(1_700_000_000_000);
  });
});
