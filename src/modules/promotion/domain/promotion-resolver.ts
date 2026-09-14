import { Engine, type RuleProperties, type TopLevelCondition } from 'json-rules-engine';
import type { Logger } from 'pino';
import type { CandidateFacts } from './dto/candidate-facts.js';
import type { CandidateLevel } from './dto/candidate-level.js';
import type { PromotionRuleRow } from './dto/promotion-rule-row.js';
import { selectCandidateEvent } from './dto/select-candidate-event.js';

export class PromotionResolver {
  constructor(
    private readonly engine: Engine,
    readonly ruleIds: readonly number[],
  ) {}

  static async fromRules(
    rows: readonly PromotionRuleRow[],
    logger: Logger,
  ): Promise<PromotionResolver> {
    const active = rows
      .filter((row) => row.active && row.type === 'promotion')
      .sort((a, b) => b.priority - a.priority || a.id - b.id);

    if (active.length === 0) {
      throw new Error('no active promotion rules (none seeded, or every rule deactivated)');
    }

    PromotionResolver.reportSharedPriorities(active, logger);

    const engine = new Engine();
    for (const row of active) engine.addRule(PromotionResolver.toRule(row));

    return new PromotionResolver(
      engine,
      active.map((row) => row.id),
    );
  }

  /** Every product goes through the rules, one candidate included: a rule that
   *  rejects a candidate outright must be consulted there too, or it is a
   *  control that is present and never runs. */
  async select(facts: CandidateFacts): Promise<CandidateLevel | undefined> {
    const { results } = await this.engine.run(facts);

    // All matching events come back; the seed's priority picks, not position.
    const winner = results.reduce<(typeof results)[number] | undefined>(
      (best, result) => (best === undefined || result.priority! > best.priority! ? result : best),
      undefined,
    );

    return winner === undefined ? undefined : selectCandidateEvent.parse(winner.event).params.level;
  }

  private static toRule(row: PromotionRuleRow): RuleProperties {
    const where = `promotion rule ${String(row.id)} ("${row.name}")`;
    const event = selectCandidateEvent.safeParse(row.event);

    if (!event.success) {
      throw new Error(`${where} has a malformed event: ${event.error.issues[0]?.message}`);
    }

    return {
      name: where,
      priority: row.priority,
      conditions: row.conditions as TopLevelCondition,
      event: event.data,
    };
  }

  private static reportSharedPriorities(rows: readonly PromotionRuleRow[], logger: Logger): void {
    const shared = rows.filter((row, index) => rows[index + 1]?.priority === row.priority);

    if (shared.length > 0)
      logger.warn(
        { rules: shared.map((row) => ({ id: row.id, name: row.name, priority: row.priority })) },
        'promotion rules share a priority, so which one selects the candidate is not decided by the policy',
      );
  }
}
