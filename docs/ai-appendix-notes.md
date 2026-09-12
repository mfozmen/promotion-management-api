# AI appendix notes

Running source of truth for `Form 5_AI Appendix.docx`, maintained by the
`docs-scribe` agent before every push. Entries are appended and dated, never
rewritten.

## Tool manifest

| Model / Tool                            | Primary purpose                                                               | Effectiveness (1-5) and why |
| --------------------------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Claude Code (Claude Fable 5.1)          | Infrastructure design, scaffolding, CI, agent definitions, TDD implementation | pending                     |
| Claude Code Action (subscription)       | Advisory review on every pull request                                         | pending                     |
| Local agents (`.claude/agents/`)        | Pre-push e2e and impact verification, design critique, documentation          | pending                     |
| Claude Code (Claude Opus 5, 1M context) | Test-first implementation of the pricing core (issue #8)                      | pending                     |

## AI tool usage approach

### 2026-09-12 — Infrastructure (PR #1)

- Strategy: gave the full case study PDF and hard process constraints (TypeScript, TDD, Conventional Commits, PR-only, SonarCloud, advisory AI review). Asked for a design before any scaffolding, approved it, then let parallel agents build disjoint parts.
- Human refinement: rejected required human approval in branch protection (owner cannot approve own PRs) in favour of a label-and-comment protocol; asked for coverage to be enforced at commit time instead of a paid SonarCloud gate; asked for the original Form 5 docx instead of a Markdown rewrite.

### 2026-09-12 — Domain design (PR #3)

- Strategy: the owner brought a pre-drafted CQRS architecture (PostgreSQL write store, Redis read store, BullMQ, dual `json-rules-engine` layers, reconciler, alarms) produced in an earlier Claude conversation, plus a diagram, and asked for an inconsistency review against the case study and the repository conventions rather than a fresh design. In parallel Claude Code had drafted an alternative (read-time SQL pricing with a versioned Redis cache) and run the `architecture-critic` agent on it.
- Human refinement: the owner chose the CQRS core, accepted the corrections list, added the safety-net requirement (self-healing plus manual queue intervention), and cut alarm delivery to a log-level signal. Decisions were recorded as ADR-0003 to ADR-0007 in a dedicated PR before any feature code.

### 2026-09-12 — Alarm delivery decision revised (PR #3)

- Strategy: after the log-level alarm decision recorded above, the owner asked for a real alarm simulation rather than a log-line signal.
- Human refinement: ADR-0007 was updated to replace the `level: "alarm"` log lines with a Prometheus/Grafana monitoring stack (`prom-client` metrics on the API and workers, a `monitoring` compose profile, provisioned Grafana dashboard and alert rules for queue depth, dead-letter jobs, read-model drift, latency, error rate, worker memory and stuck chunks). Commit `6120b8c`.

### 2026-09-12 — Requirements analysis and owner decisions (design phase)

- Strategy: traced every case-study requirement (R1-R8, A1-A4, B1-B4, D1-D4) to a plan package and surfaced four gaps as single-choice questions instead of deciding silently.
- Human refinement: K1 add a separate `assign` endpoint with a `draft` status so the API matches the case wording literally; K2 add promotion read endpoints for the admin path; K3 vendor prices arrive as decimals and are parsed to integer cents; K4 no product update endpoint, the vendor feed is the only update channel.

### 2026-09-12 — Four-agent local-gates (PR #21, d8a436a, b61d4c4)

- Strategy: extended the `local-gates` required check to read the PR's file list and labels and compute which local-agent labels apply — `docs-verified` is required on every PR, `architecture-verified` only when the PR touches `ADR.md`, `docs/superpowers/specs/` or carries the `scenario` label. All four labels are still stripped on every push.
- Human refinement: the owner asked for the gate to cover all four local agents, not just `e2e-tester` and `impact-analyzer` — docs and architecture review were process-only before this and easy to skip. `docs-scribe` moved from "after every merge" to "before every push, on the branch", so documentation lands in the same PR instead of trailing it.

### 2026-09-12 — Review rulebook (commit `4f049ec`)

- Strategy: owner asked for a `REVIEW.md` rulebook as the first task after
  planning, encoding the case's sharpest failure modes — race conditions,
  high-traffic hygiene, serverless ingestion constraints, and money/time
  exactness — as numbered, severity-tagged rules. Wired the same file into
  the advisory Claude review workflow, the `architecture-critic`,
  `e2e-tester` and `impact-analyzer` agent definitions, `CLAUDE.md` and
  `CONTRIBUTING.md` so every reviewer (AI or human) cites rule numbers
  instead of restating them.
- Human refinement: the first draft of rule 3 was corrected after the
  `impact-analyzer` run (see the entry below, commit `2f271fa`).
- Follow-up (commit `44a06a5`): the owner asked for staff-level depth —
  explicit coverage of race conditions, loop performance at 500 000-row
  scale, and the edge-case tests a senior reviewer would demand — so the
  10-rule draft was expanded into a 14-section rulebook (money and time,
  database invariants, concurrency and ordering, serverless ingestion, the
  read path, loop and query performance, tests and edge cases, API
  boundaries, failure handling, observability, migrations, scope hygiene,
  repository hygiene, and a six-question reviewer quick pass).

### 2026-09-12 — Review process rework (PR #23, process/review-policy, commit `df45910`)

- Strategy: the owner asked why recent PRs needed so many review rounds.
  Reviewed the PR history end to end instead of assuming one cause, and found
  five contributing habits: the Claude review re-analysed the whole diff on
  every push instead of picking up only the commits pushed since the last
  summary; Warning-severity findings were being fixed in the PR as if they
  were blocking, same as Critical; some of my own fixes were made in the
  working tree but not committed before the next push; a PR sometimes
  referenced work that only landed in a later, still-open PR; and pushing a
  new commit while a review run was in flight cancelled it and forced a full
  restart.
- Human refinement: owner asked for one policy PR rather than five scattered
  fixes. This PR is that change: `claude-review.yml`'s prompt now reads prior
  summary comments (`gh pr view --comments`) and reviews only new commits;
  `CONTRIBUTING.md` and `CLAUDE.md` now state the same severity policy
  (Critical and REVIEW.md-blocking findings fixed before hand-off, Warnings
  answered and deferrable to a linked issue, Suggestions answered) so a
  Warning stops defaulting to "fix everything"; and the batched-fix rule now
  waits for the review run to finish before committing findings in one
  commit, instead of reacting mid-run, which also closes the uncommitted-fix
  and mid-review-push gaps.

### 2026-09-12 — CLAUDE.md trimmed to derivable content (branch `docs/trim-claude-md`)

- Strategy: a `/doctor`-style health check flagged that CLAUDE.md's "Stack" and "Commands" sections duplicated `package.json` verbatim; replaced both with one sentence pointing there instead.
- Human refinement: none needed — `impact-analyzer` confirmed no doc or config referenced the removed sections and every named script (`dev`, `test`, `test:cov`, `lint`) still exists in `package.json`.

### 2026-09-12 — Pricing core (issue #8, branch `feat/pricing-core`)

- Strategy: Claude Opus 5 (1M context) via Claude Code, test-first. The prompt gave the already-recorded decisions (ADR-0004 and `docs/superpowers/specs/2026-09-12-domain-design.md` section 4) and REVIEW.md rules 1.1 to 1.7 as the contract, and scoped the work to a pure module: no endpoint, job, cache or store. `tests/pricing/effective-price.test.ts` was written and run red first, then `src/modules/pricing/effective-price.ts` (`applyPromotion`, `isActive`, `resolveApplied`) was written to make it green.
- Human refinement: kept the module pure and free of `new Date()` so the clock is injected by the caller, and held the scope to the formula plus window and precedence resolution instead of pulling the read path forward. No new architectural decision was introduced, so ADR.md and the spec were deliberately left untouched.

### 2026-09-12 — Comment trim after a mid-branch rule change (commit `1baf4e6`)

- Strategy: `origin/main` was merged into the branch and brought REVIEW.md 12.3
  ("comments earn their line"), a rule added after this branch opened. The
  AI-written module carried 50 comment lines in 95; the owner directed a trim
  rather than an exception for work already in flight.
- Human refinement: 58 lines with 13 of comment, keeping only what the code
  cannot say (units of `value`, the half-open window, why `id` and `name` are
  absent, `applyPromotion`'s unchecked-window contract, why the percentage step
  is `bigint`, what the clamp is for); arithmetic narration was dropped from the
  tests too.
- Verification: no behaviour change — the same 25 tests pass at 100 % statement,
  branch, function and line coverage.

## Judgement, challenges and verification

### 2026-09-12 — REVIEW.md rule contradicted the approved design (review-rules PR)

- Challenge: the first draft of rule 3 demanded that a category recompute never let a listing show mixed prices, and described per-category serialisation. The approved design (ADR-0006) deliberately accepts a short mixed-price window during a pipelined keyset recompute and serialises with one event-handler instance at concurrency 1. Left as written, the rulebook would have blocked the very implementation the design prescribes.
- Verification: caught by the `impact-analyzer` agent run before push, which compared every REVIEW.md rule against the design spec on the open design PR.
- Resolution: rule 3 now names the actual serialisation mechanism and accepts the window, while still flagging unretried half-way stops and per-product round trips (commit `2f271fa`).

### 2026-09-12 — `local-gates` check masked its own failure (PR #1)

- Challenge: the first version of the label-gating job swallowed a failed label removal with `|| true`, so a stale "verified" label could have covered new commits. It also re-ran the full CI job on every label event.
- Verification: caught by the `impact-analyzer` agent run before push, which traced the workflow event flow and the token permissions.
- Resolution: moved the job to its own workflow, removed the mask, serialised runs per PR, and added the check to branch protection.

### 2026-09-12 — Design mistakes in the first AI architecture (PR #3)

- Challenge: the earlier AI-produced architecture had five structural errors, four of them in the two graded scenarios. (1) Ingestion streamed the whole 500 000-row file inside one HTTP request and enqueued 5 000-row payloads, which is not serverless-shaped: the request itself hits the timeout, the payloads fill Redis, and a queue retry restarts a chunk from zero. (2) `product_promotions(product_id unique)` claimed to enforce one active promotion per product but ignored time (blocking scheduled promotions and requiring cancelled rows to be deleted) and ignored category promotions entirely, leaving the conflict check in application code where it races. (3) Promotions were modelled twice, as rows and as JSON rules, with no defined source of truth. (4) The read-model rebuild called `FLUSH` on the same Redis that held the BullMQ queue, so a rebuild would have erased queued work. (5) Nothing fired at a promotion's `starts_at` or `ends_at`, so scheduled starts and expiries depended on the five-minute reconciler.
- Verification: each point was checked against the case text (serverless constraints, "instantly affects", one active promotion) and against PostgreSQL and BullMQ semantics; the `architecture-critic` agent independently rejected Claude Code's own alternative draft and supplied concrete failures (offset regression under duplicate delivery, duplicate SKUs aborting a batch, byte versus character offsets, uncomputable cache keys) that also applied to the unified design.
- Resolution: file stored first and line-aligned byte-range chunks enqueued; per-chunk lease plus compare-and-set checkpoint committed with the batch; exclusion constraints on `tstzrange` at both promotion levels; promotions kept as data with `json-rules-engine` limited to ingestion rules; separate Redis logical databases and `SCAN`+`UNLINK`; delayed BullMQ jobs at promotion boundaries with a reconciler sweep as backstop.

### 2026-09-12 — Review findings on the assign mutation (PR #3)

- Challenge: two omissions surfaced in review of the domain-design spec. (1) `assign` moved a promotion from `draft` to `active` without producing a `promotion.changed` event, so an assigned promotion would never reach the Redis read model. (2) The `assign` guard checked only `status = 'draft'`, so a draft whose `endsAt` had already passed could still be activated dead, silently violating the "at least one applied promotion is currently valid" assumption.
- Verification: traced every producer of `promotion.changed` against the events table (section 6) and found `assign` missing; traced the assign `UPDATE` against the create-time validation (`endsAt > now()`) and found it absent from the assign guard.
- Resolution: commit `1352e88` added `assign` as a `promotion.changed` producer alongside create and cancel; commit `f03d09a` added `and ends_at > now()` to the assign guard, documented the three zero-row cases (not a draft, a concurrent assign won, or the window has already ended), named the two additional required tests (assigning an expired draft; a product created in a promoted category discounted on first read), and mirrored the "or assigning" clause into ADR-0006.

### 2026-09-12 — `local-gates` labels only existed by hand (PR #21, 846f04f, 465aac9)

- Challenge: the four verification labels (`e2e-verified`, `impact-verified`, `docs-verified`, `architecture-verified`) had only ever been created by hand in the repo's label set; `gh pr edit --remove-label` on a label that does not exist fails, so a fresh clone would break on the first `synchronize` strip. The fix step (`gh label create --force`) was first added to run unconditionally, over-creating the labels on every `labeled`/`unlabeled`/`reopened` event too.
- Verification: caught by the `impact-analyzer` agent reasoning through the workflow's `on.pull_request.types` list against the create step's `if` condition.
- Resolution: scoped the create step to `if: contains(fromJSON('["opened", "synchronize"]'), github.event.action)`, the only events that precede the strip step, so labels are created idempotently once per event that needs them instead of on every label change.

### 2026-09-12 — Pricing core verification (issue #8)

- Challenge: no AI mistake needed correction in this change; the risk was a silently wrong money or boundary rule rather than a broken build.
- Verification: 24 unit tests written before the implementation cover integer flooring, the zero clamp on an over-large fixed discount, the half-open `[startsAt, endsAt)` boundaries, draft and cancelled promotions, and product-over-category precedence including the case where the category discount is larger. `npm run lint`, `npm run typecheck` and `npm run test:cov` all pass, with 100 % statement, branch, function and line coverage. The local pre-push agents (`e2e-tester`, `impact-analyzer`, `docs-scribe`) gate the push as required by the `local-gates` check.
- Resolution: no correction required; the module shipped as first written against the red tests.

### 2026-09-12 — Pricing core: two AI defects caught before merge (issue #8, commit `9465bcc`)

- Supersedes the entry above ("Pricing core verification"): its sentence "no AI
  mistake needed correction in this change" is wrong and is corrected here. Two
  defects in the AI-written first implementation were found by the local agents
  and fixed before the branch was pushed; a third was recorded and deferred.
- Challenge 1 — precision loss in the percentage discount. The first
  implementation computed `Math.floor((basePriceCents * promotion.value) / 10000)`
  in JavaScript numbers. The `impact-analyzer` agent returned FAIL: the product
  `basePriceCents * value` leaves the exact-integer range of an IEEE-754 double
  once it exceeds 2^53, which the `bigint` price columns allow, so the floor
  returns the wrong cent.
- Verification 1: the agent produced a concrete counter-example and checked it
  against BigInt as the oracle — base 4 171 863 899 102 minor units at 7 049
  basis points gave a discount of 2 940 746 862 477 where the exact floor is
  2 940 746 862 476. That is one cent in the direction REVIEW.md 1.4 promises
  cannot happen. The same report noted that REVIEW.md 7.4's "largest price the
  column allows" case was missing from the test file.
- Challenge 2 — one-sided clamp. The `architecture-critic` and `e2e-tester`
  agents independently flagged that only the lower bound was clamped, so a
  negative `value` returned a price ABOVE the base price, contradicting
  REVIEW.md 1.5.
- Resolution: the percentage step now multiplies in `bigint` (truncating
  division is the floor for non-negative operands) and the result is clamped
  into `[0, basePriceCents]`. Three tests were added first and seen to fail
  before the fix: the largest price the representation allows, the
  `impact-analyzer`'s counter-example, and never-above-base.
- Deferred, not fixed: the `architecture-critic` pointed out that two clocks
  decide whether a promotion is active — the SQL
  `tstzrange(starts_at, ends_at) @> now()` filter in the design spec's
  resolution query, and the injected `Date` passed to `isActive` — which is
  REVIEW.md 1.7. No query exists on this branch, so nothing is inconsistent
  yet; it is recorded as GitHub issue #28 for an ADR-0004 decision rather than
  decided here.
- Verification of the fix: `npm run lint`, `npm run typecheck` and
  `npm run test:cov` all pass with 25 tests and 100 % statement, branch,
  function and line coverage, and all four local agents were re-run on the
  final commit `9465bcc`.

### 2026-09-12 — Pricing core: deferred two-clocks item sharpened (issue #8, commit `2322c4d`)

- Note on hashes: the branch was amended, so the entry above should be read
  against commit `2322c4d`, not `9465bcc`.
- Challenge: an `architecture-critic` re-run on the final branch state found
  that the deferred two-clocks item recorded above was written with one wrong
  assumption and one missing half. (1) Its "take `now` from `select now()`"
  option does not close the gap: a JavaScript `Date` holds whole
  milliseconds while `timestamptz` holds microseconds, so a boundary such as
  `ends_at = 2026-09-13T00:00:00.000400Z` still has PostgreSQL and `isActive`
  disagree after the driver truncates it; only making PostgreSQL
  authoritative removes the disagreement. (2) The design spec's resolution
  query projects `id`, `name`, `discount_type` and `value` per level and no
  window columns, so it cannot build the `Promotion` the pricing core takes
  without widening a query that runs over a whole category — the type shape
  is part of the same decision, not a separate one.
- Verification: the microsecond counter-example was checked against
  `timestamptz` precision and the JavaScript `Date` representation; the
  projection gap was traced column by column from section 4 of
  `docs/superpowers/specs/2026-09-12-domain-design.md` to the exported
  `Promotion` interface.
- Resolution: both points were appended as a comment on issue #28 so the
  ADR-0004 decision is taken with them, and the one part that needed no
  decision was applied on the branch — `id` and `name` were dropped from the
  exported `Promotion` interface, since the caller keeps the resolved row for
  the response and no rule in the module reads them. The remaining gap
  (`status`, `startsAt`, `endsAt`) stays with issue #28.

## Overall reflection

- Estimated ratio: pending.
- Key takeaway: pending.

### 2026-09-12 — Pricing core: advisory AI review caught a defect four local agents missed (issue #8, PR #29, commit `a60877d`)

- Challenge: `applyPromotion` called `BigInt()` on its two `number` parameters
  with no integer guard. `BigInt()` raises a RangeError on a fractional, NaN or
  infinite value, so the percentage branch threw on
  `applyPromotion(1000.5, ...)`, while the `fixed` branch never reached
  `BigInt()` and silently returned `750.5` or `NaN` as a price — a money value
  that is not a whole minor unit, which nothing downstream would have noticed.
  The same commit's review also found a comment asserting that the `bigint`
  quotient is at most the base so the conversion back with `Number` is always
  exact; that held only while `value <= 10000`, an invariant the module
  deliberately does not enforce.
- Verification: found by the advisory Claude Code Action review on the PR, not
  by the local agents — three earlier review passes and all four local agents
  (`e2e-tester`, `impact-analyzer`, `architecture-critic`, `docs-scribe`) had
  passed the same code. The reviewer verified the behaviour in Node against the
  exact expression rather than reasoning about it, and pointed at the sibling
  module `src/modules/pricing/ingestion-rules.ts` (PR #39), whose `priceRow`
  already guards with `Number.isSafeInteger` — two modules in one folder
  disagreeing about whether the guard was needed.
- Resolution: one `Number.isSafeInteger` guard at the top of `applyPromotion`
  covering both amounts and both branches, throwing a RangeError that names the
  offending value, with the contract written into the docblock: callers read
  whole minor units out of `bigint` columns, so a violation is a caller bug,
  while an untrusted vendor row is `priceRow`'s job and that one returns a
  rejection instead of throwing so a single row cannot abort a batch. The clamp
  now runs in `bigint` before the conversion back, so the result is inside
  `[0, basePriceCents]` and exactly representable for any discount size — which
  makes the comment true instead of deleting it.
- Verification of the fix: tests written red first for both amounts fractional,
  NaN, infinite and past 2^53 on both discount types, plus a percentage above
  100 % clamping to zero, a zero discount, an inverted window and two
  `resolveApplied` combinations. 32 tests pass (31 in the pricing file) at 100 %
  statement, branch, function and line coverage; `npm run lint` and
  `npm run typecheck` are clean and all four local agents were re-run.
- Honest note: 100 % line coverage did not reveal this. Every guarded input was
  outside the range the tests exercised, so the uncovered risk was in the input
  domain, not in the lines — which is REVIEW.md 7.2's own point about coverage
  not being an edge-case test.
