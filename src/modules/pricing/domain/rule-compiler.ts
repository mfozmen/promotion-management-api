import { Engine, type RuleProperties, type TopLevelCondition } from 'json-rules-engine';

import { adjustmentEvent } from './dto/adjustment-event.js';
import { CompiledRuleSet } from './compiled-rule-set.js';
import type { PricingRuleRow } from './dto/pricing-rule-row.js';
import type { VendorRowFacts } from './dto/vendor-row-facts.js';

const PROBE_ROW: VendorRowFacts = { category: 'probe', vendorPriceCents: 0, stockQuantity: 0 };

export class RuleCompiler {
  async compile(rows: readonly PricingRuleRow[]): Promise<CompiledRuleSet> {
    const active = rows
      .filter((row) => row.active && row.type === 'ingestion')
      .sort((a, b) => b.priority - a.priority || a.id - b.id);
    if (active.length === 0) {
      throw new Error('no active ingestion pricing rules (none seeded, or every rule deactivated)');
    }
    const engine = new Engine();

    for (const [rank, row] of active.entries()) {
      const where = `pricing rule ${row.id} ("${row.name}")`;
      const event = adjustmentEvent.safeParse(row.event);
      if (!event.success) {
        throw new Error(`${where} has a malformed event: ${event.error.issues[0]?.message}`);
      }
      if (this.hasEmptyGroup(row.conditions)) {
        throw new Error(`${where} has an empty all or any, which matches every row or none`);
      }
      const properties: RuleProperties = {
        // A fired rule is reported by name only, so the id rides in the name to reach
        // `rejectedBy`; the rank, not the stored priority, gives one rule per priority set.
        name: where,
        priority: active.length - rank,
        conditions: row.conditions as TopLevelCondition,
        event: event.data,
      };
      try {
        engine.addRule(properties);
        await new Engine([
          {
            ...properties,
            conditions: this.withoutPriorities(row.conditions) as TopLevelCondition,
          },
        ]).run(PROBE_ROW);
      } catch (error) {
        throw new Error(`${where} cannot be compiled: ${(error as Error).message}`);
      }
    }

    const newest = active.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0);
    return new CompiledRuleSet(
      engine,
      active.map((row) => row.id),
      newest,
    );
  }

  private withoutPriorities(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((child) => this.withoutPriorities(child));
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'priority')
        .map(([key, value]) => [key, this.withoutPriorities(value)]),
    );
  }

  private hasEmptyGroup(node: unknown): boolean {
    if (Array.isArray(node)) return node.some((child) => this.hasEmptyGroup(child));
    if (node === null || typeof node !== 'object') return false;
    const groups = Object.entries(node).filter(([key]) => key === 'all' || key === 'any');
    if (groups.some(([, value]) => Array.isArray(value) && value.length === 0)) return true;
    return Object.values(node).some((value) => this.hasEmptyGroup(value));
  }
}
