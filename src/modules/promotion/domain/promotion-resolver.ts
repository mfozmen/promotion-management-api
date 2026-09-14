import { Engine, type RuleProperties, type TopLevelCondition } from 'json-rules-engine';
import type { Logger } from 'pino';
import type { CandidateFacts } from './dto/candidate-facts.js';
import type { CandidateLevel } from './dto/candidate-level.js';
import type { PromotionRuleRow } from './dto/promotion-rule-row.js';
import { selectCandidateEvent } from './dto/select-candidate-event.js';

/** Which promotion applies to a product, decided by rows rather than by a branch
 *  here, so the policy changes without a deploy. Each candidate is priced by
 *  `EffectivePriceCalculator` before the rules run, so a rule compares outcomes
 *  and never does arithmetic. */
export class PromotionResolver {
  /** Tests build one around their own engine; production goes through fromRules. */
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

  /** Undefined when no rule fired, which is a product with no candidate — or a
   *  policy that stopped covering a case, and the caller prices at base either
   *  way. Every product goes through the rules, including one with a single
   *  candidate: a rule that rejects a candidate outright has to be consulted
   *  there too, or it is a control that is present and never runs. */
  async select(facts: CandidateFacts): Promise<CandidateLevel | undefined> {
    const { results } = await this.engine.run(facts);

    // Every matching event comes back, not the first, and same-priority rules
    // run concurrently, so position is the library's business and priority is
    // the seed's.
    // `priority` is optional in the typings and always set by the library, which
    // a test pins against the installed version.
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

  /** A tie makes the winner an ordering detail rather than a policy, and the
   *  only writer is a person at a psql prompt, so this is said rather than
   *  enforced. */
  private static reportSharedPriorities(rows: readonly PromotionRuleRow[], logger: Logger): void {
    const shared = rows.filter((row, index) => rows[index + 1]?.priority === row.priority);

    if (shared.length > 0)
      logger.warn(
        { rules: shared.map((row) => ({ id: row.id, name: row.name, priority: row.priority })) },
        'promotion rules share a priority, so which one selects the candidate is not decided by the policy',
      );
  }
}
