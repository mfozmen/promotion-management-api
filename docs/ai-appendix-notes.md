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

### 2026-09-12 — Rulebook expansion from review findings (PR #46, `docs/comment-density`)

- Strategy: six review findings this session were classes of mistake rather
  than one-off fixes, so each became a `REVIEW.md` rule in the same PR
  instead of a silent code fix, per the new 13b policy this PR also adds.
- Human refinement: substantial, and in the blocking direction. The owner's
  review (commit `3b5af3b`) reversed the 8c naming direction the model had
  proposed and dropped the 8b comment-ratio threshold entirely: a percentage
  gate passes every file that hits the number while still deleting
  load-bearing contracts, so 8b now judges what a comment says rather than how
  many lines it occupies. The owner also ruled that a mistake made
  unstateable in the type beats a rule asking nobody to make it (8c.5, commit
  `26a8de8`), which is the opposite of the model's instinct to add a rule per
  finding. Each rule below states its own failure; the shape of the rules is
  the owner's.
  - 2b (business data lives in the database, commit `15116a6`): a story
    written before its table invented a `DEFAULT_PRICING_RULES` constant to
    stand in for rows, which then had to be removed, re-tested and
    re-documented once the table existed.
  - 8b (comments, commits `8fe3efe`, `a2aeef3`): the old comment rule
    ("Comments earn their line", numbered 12.3 on `main` and retired here)
    never fired — it triggered only when comments outweighed code, sat in a
    suggestion-severity section, and the review prompt never asked anyone to
    measure — while four files in flight sat between 34% and 67% comment
    lines; then a trimming pass hit the new ratio on every file and still
    deleted two load-bearing contracts, and twice in one round a fix landed
    in the code while the identical claim stood unchanged in the ADR.
  - 8c (names match, commit `ef1d8e5`): `src/shared/http-error.ts` exported
    one class, `AppError`; a reader who saw the name in a stack trace grepped
    for `app-error` and found nothing. Renumbering the section after the
    owner's ruling then dropped the "same thing is called the same thing
    everywhere" rule instead of moving it, which the owner's next review
    caught; it is back as 8c.6, with ADR-0004 stating the promotion
    precedence rule three different ways in one section as its evidence.
  - 7.4b (a control is proved in the configuration production runs, commit
    `936ab84`): twice in one pull request a control passed review while never
    firing in production — Express prints a raw stack on every environment
    except `test`, which is the one the suite runs in, and a compensating
    `debug` log line sat under a root logger at `info` while the capture
    logger in the test ran at `trace`.
  - 8.3b and 8.3c (never echo what the client sent, and bound what you do
    echo, commits `b30574a`, `936ab84`, `55b6634`): the
    don't-echo-client-input rule was applied in two places out of three — a
    404 withheld the path and body-parser messages were replaced, but zod
    quoted the rejected key back and a test asserted it. The first draft of
    the field-name exception then had no length bound, so a multi-kilobyte
    key would have come straight back in the error body; 8.3c caps it at 64
    characters and truncates rather than omits.
  - 13b (the rulebook learns, commit `2a2f479`): each of the findings above
    became a rule only because someone happened to notice; 13b makes turning
    a recurring finding into a rule (and fixing a rule that never fires) the
    expected step instead of a good habit.

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

### 2026-09-12 — SonarCloud issue gate, then two owner-review corrections (PR #56)

- Strategy: the free SonarCloud plan's quality gate conditions are ratings and coverage, so a CRITICAL code smell can pass it; asked for a CI step (`scripts/sonar-issues.mjs`) that queries the Sonar issue-search API directly for the pull request and fails the build on anything unresolved, enforcing REVIEW.md 13.6 in code instead of prose. Wrote the retry loop, then the owner's review found it did not retry a thrown fetch error, and that an issue accepted, won't-fixed or false-positived from the SonarCloud web interface still passed the gate. Both were fixed in commit `737ea88`, with `tests/sonar-issues.test.mjs` (a stubbed rejecting fetch) as the first test for the script — deliberately a `.mjs` file so it stays outside the TypeScript project and the `src/**` coverage scope.
- Human refinement: owner asked for `sonar.qualitygate.timeout=300` set explicitly (commit `cae6bc2`) after asking why an open-ended wait was acceptable, and for the false "written by drizzle-kit rather than by hand" evidence clause removed from `REVIEW.md` 13.6 once PR #50 established `0000_write_store.sql` was hand-extended and `0001_seed_pricing_rules.sql` hand-written.

### 2026-09-12 — Agent rounds required by changed path (PR #46, `021de82`)

- Strategy: `local-gates` demanded all three agent labels on every pull
  request, so a markdown-only branch waited for a load run that could not
  find anything. The required set is now computed from the pull request's
  changed paths, sorted into two named groups: **behaviour** (changes how the
  running application or its build behaves) and **judgement** (changes how the
  work itself is judged). `docs-scribe` always, because any change can outdate
  the ADRs, the README or this appendix; `e2e-tester` for the behaviour group;
  `impact-analyzer` for both; `architecture-critic` unchanged. An agent
  definition sits in both groups — the agent must be exercised, and every
  branch in flight is judged by it. CLAUDE.md and CONTRIBUTING.md list the
  same two groups so the prose and the gate cannot drift.
- Human refinement: substantial, in two rounds. The owner set the scope
  (required by what a diff can break, not by the fact that a diff exists) and
  named the consequence for this pull request itself, which touches
  `.github/workflows/` and therefore needs `docs-verified` and
  `impact-verified` but not `e2e-verified`. The owner then found five kinds
  of file the first patterns dropped — `.claude/agents/`, `scripts/`,
  `*.config.mjs` and `*.config.js`, `.husky/` and `sonar-project.properties`
  — and required the restructure into two named groups rather than five
  more alternatives bolted onto one regular expression. The sharpest of the
  five: PR #44 rewrote the e2e tester's own definition and would have
  shipped without a single e2e run.

### 2026-09-12 — SonarCloud scanned only when it has something to read (PR #56, `abf5ca9`, `cd87e86`)

- Strategy: every documentation or workflow pull request was paying for a
  SonarCloud analysis of an unchanged `sonar.sources`/`sonar.tests`, producing a
  copy of the previous result. A step in `ci.yml` now decides from the pull
  request's changed files whether anything analysable moved (sources, tests, a
  build or tool configuration, `sonar-project.properties`) and gates the scan on
  it; a push to `main` always scans, so the branch analysis never goes stale.
- Human refinement: the owner drew out the consequence the patch did not state —
  SonarCloud's own check cannot stay a required check once it can legitimately
  never report, because a required check that never reports blocks such a merge
  forever. Commit `cd87e86` removed `SonarCloud Code Analysis` from the hand-off
  list in CONTRIBUTING.md; `ci`, which carries the scan and waits for the quality
  gate, is the required check instead. README.md's merge rule was corrected in
  the same round, since it still named the quality gate as a separate merge
  condition. Later the same day the issue-gate script this branch was opened for
  was deleted (commit `b91db0d`); what the earlier PR #56 entry in this section
  describes is therefore history, not the shipped state — see "A CI gate built,
  reviewed twice, then deleted" under Judgement.

### 2026-09-12 — Rewritten base merged into the pricing branch, two conflicts resolved (PR #29, merge `4e1a650`)

- Strategy: the design base `origin/docs/promotion-rule-engine` was rewritten
  (its tip is the merge `c769001`), so it was merged into `feat/pricing-core`
  rather than rebased onto, keeping the review trail of the four reshapes this
  pull request already carries. Two files conflicted: `REVIEW.md` and
  `docs/ai-appendix-notes.md`.
- Human refinement, `REVIEW.md`: the branch's own one-declaration-per-file
  block, numbered 13.6 there, was dropped and the base's file taken, because
  that rule reached `main` as 8c.2 and 13.6 is now the SonarCloud rule. The branch's other
  edit was kept deliberately — rule 1.3 points at
  `src/modules/promotion/effective-price.ts` (commit `2d9004c`), since
  `src/modules/pricing/` does not exist after the revert `1e624f5` and PR #39
  owns that directory. Taking the base wholesale would have pointed the
  single-implementation rule at a path with nothing in it.
- Numbering note for readers of the older entries below: the entry "the
  abstraction did not match the domain" (`1e624f5`) records one-declaration-
  per-file as REVIEW.md 13.6, which was true when it was written. The rule is
  now 8c.2. History in this file is not rewritten, so the pointer is given here
  instead.
- Human refinement, `docs/ai-appendix-notes.md`: both sides had appended
  different entries about different pull requests, which is the expected shape
  of a conflict in an append-only file. Both sides were kept, ordered by date,
  and the seam re-read so the result is two entries rather than one spliced
  paragraph. No entry from either side was edited or dropped.

### 2026-09-12 — Reversal reconciled in the documents before the code (PR #35, `7105a12`)

- Strategy: the owner reversed the design this branch had been building for
  seven commits — promotion and pricing stay separate modules, and a promotion
  keeps `discount_type` plus `value` instead of a `calculator` registry key and
  a `params` jsonb bag. The reconciliation was asked for as a document change
  first: rewrite section 4 of the domain spec and ADR-0004 so the rule event
  names the winning _level_ and nothing else, and the arithmetic is one pure
  function, `applyPromotion(basePriceCents, promotion)` returning a
  `PricingOutcome` union. Then let the code branches (#29, #50) follow.
- Human refinement: the ordering is the point and it is the owner's. The
  advisory review had asked three times on #29 for the decision to be recorded
  before the implementation, and this is the first round where that happened:
  the design that was reversed was described in enough detail that anyone
  implementing the resolver top to bottom would have built a rule event
  carrying a calculator name and resolved nothing for every product. What was
  left after `7105a12` was therefore superseded prose rather than a missing
  update — a smaller and more findable class of defect, but not a free one, as
  the next entry records.

### 2026-09-12 — Three owner rulings closed the precedence round (PR #35, `beba163`)

- Strategy: the round was run as three separate questions rather than one
  "fix the docs" pass — what the seeded precedence policy is, whether a test
  may assert it, and what the 60 s rule cache does on a policy edit. Each was
  put to the owner with the passages that would have to change, so the ruling
  arrived as a decision rather than as an edit to review.
- Human refinement: the owner ruled the lower effective price, in the
  customer's favour, with a higher-priority rule overriding — the reverse of
  the product-level default the branch had carried and the reverse of the
  correction made in the previous documentation pass. REVIEW.md 7.4 was
  amended to match and "precedence by larger discount" left ADR-0004's
  rejected alternatives, since it is the default under another name.
  Product-level precedence took its place there, with the reason. The owner
  also ruled the capped-discount bullet out of scope and corrected the
  required-check set in CONTRIBUTING and the infrastructure spec to the live
  one (`ci` and `claude-review`; `local-gates` runs and is read at hand-off
  but does not block; the title job is gone); README.md was brought to the
  same set in this pass.
- The 60 s rule cache has no invalidation. Recorded in ADR-0004 as a known gap
  with its window, what is re-resolved and the two things that would fix it,
  and deliberately not built.

### 2026-09-13 — End-to-end cases written from the story, not from the code (issue #8, PR #29, `08b5033`)

- Strategy: the repo's first end-to-end case file (`docs/e2e-cases/8.md`). The
  context given was issue #8's acceptance criteria and the settled precedence
  decision (ADR-0004); `src/modules/promotion/effective-price.ts` was withheld
  on purpose, so a case that only restates what the implementation happens to do
  could not be produced. Each case names the actor whose problem it is and the
  criterion it covers, and case ids are declared permanent so later files and
  tests can cite them.
- Human refinement: criterion 3 of the issue body still asserts product-level
  precedence, which the owner reversed on 2026-09-12. The cases were written
  against the settled policy, the product-level route kept as case 8-3b (the
  higher-priority override rule), and the divergence stated at the head of the
  file rather than quietly reconciled — a derived document may not pick a winner
  between two source documents without saying that it did.

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

### 2026-09-12 — Pricing core: the module had decided the arithmetic itself (issue #8, PR #29, commit `92832b7`)

- Supersedes the pricing-core entries above: they describe `applyPromotion` and
  `resolveApplied`, which no longer exist. Those entries stay as written; this
  one records what replaced them.
- Challenge: the AI-written module branched on `discountType` and computed the
  discount in its own code. The point of the rule engine is the opposite — the
  formula travels with the rule row, so a new kind of discount should be a rule
  change, not a new branch in the pricing module. Three review passes and all
  four local agents had validated the module against its own tests and the rules
  it cited, never against the architecture the design intended. Only the human
  owner caught it, in review.
- Verification: the owner wrote the intended shape into the design spec and
  ADR-0004 first (commit `09c9915` on `docs/promotion-rule-engine`, PR #35), and
  the module was then reshaped onto that recorded decision rather than onto a
  reviewer's opinion.
- Resolution (commit `92832b7`): an `Adjustment` interface (`validate`, and
  `apply(cents: bigint, params): bigint`) implemented by `PercentBpsAdjustment`
  and `CentsAdjustment`, registered by event type name behind
  `adjustmentFor(type)`; `applyPromotions(basePriceCents, event)` looks the
  strategy up. No `discountType` branch survives — a new discount kind is a new
  strategy class plus rules that emit it. The event vocabulary is shared with the
  ingestion rules and signed: `adjustPercentBps` in basis points, `adjustCents`
  in minor units. `resolveApplied` was deleted, because precedence is a rule now
  and issue #36 owns the resolver; `isActive` stays as a fact builder. Failures
  are returned rather than thrown, which also closed the blocking review thread
  about `BigInt()` raising a RangeError — the guard no longer needs to throw.
- Follow-up: issue #45 refactors `priceRow` (PR #39) onto the shared registry
  instead of editing that green branch, and carries an open rounding-direction
  question — the shared strategy floors the price while ADR-0004 still describes
  flooring the discount, and the two differ by a cent. Undecided, recorded there,
  not decided here.
- Verification of the fix: 28 tests pass at 100 % statement, branch, function and
  line coverage; `npm run lint` and `npm run typecheck` are clean and the four
  local agents were re-run.
- Honest lesson: agents and review passes checked the code against its own tests
  and the rules it cited, which is a closed loop — none of them checked it
  against the architecture the design intended. Validation that never leaves the
  artefact under review cannot detect a wrong shape.

### 2026-09-12 — Pricing core: the reshaped module rounded the wrong way (issue #8, PR #29, commit `eb1abb9`)

- Corrects the entry above: the rounding direction it recorded as an open
  question deferred to issue #45 was a defect, and is fixed here.
- Challenge 1 — the reshaped percentage strategy floored the PRICE,
  `(cents * (10000 + value)) / 10000`, contradicting ADR-0004 and REVIEW.md 1.4,
  which floor the DISCOUNT so the customer pays at most one minor unit more than
  the ideal. Base 999 at 25 % off gave 749 where the design says 750.
- Verification 1: the `impact-analyzer` (FAIL) and the `architecture-critic`
  (REVISE) caught it independently, and the critic supplied the form that
  satisfies the design and the shared-with-ingestion requirement at once:
  `cents + (cents * value) / 10000`. bigint division truncates toward zero, which
  floors the adjustment for a discount and is provably identical to the old
  expression for any non-negative value, so ingestion's markups keep the prices
  they were reviewed against. Issue #45 is updated — the rounding question is
  settled rather than deferred, and only the mechanical `priceRow` refactor
  remains.
- Challenge 2 — a markup on the promotion path was silently clamped to the base
  price and reported `ok: true`, indistinguishable from no promotion firing. It
  is now a returned rejection naming the value. The lower clamp stays silent: a
  discount larger than the price is a free product, not a defect.
- Challenge 3 — the `e2e-tester` found that an event with missing or non-numeric
  `params` threw a TypeError; a rule row is not a TypeScript value, so that is a
  returned rejection now too.
- Verification of the fix: 29 tests pass at 100 % statement, branch, function and
  line coverage; `npm run lint` and `npm run typecheck` are clean and the four
  local agents were re-run.
- Honest lesson: the previous entry recorded the rounding direction as an open
  question deferred to a follow-up issue. The agents' verdict was that deferring
  a contradiction with a blocking rule is not a remedy — the correct expression
  existed and cost one line.

### 2026-09-12 — Pricing core: the markup check compared against the wrong price (issue #8, PR #29, commit `2719dd2`)

- Corrects the entry above: the markup rejection it recorded was itself defective.
  It compared the ADJUSTED price with the base price, so an adjustment too small
  to move a cheap product's price passed as `ok: true` at the base price — exactly
  the "looks like no promotion fired" case the check exists to prevent. A `+1500`
  basis-point markup on a base of six minor units floors to nothing. The rejection
  now tests the sign of the value, before the arithmetic runs, with tests for a
  tiny base and for a base of zero.
- Two smaller defects in the same commit: the event parameter is typed as the
  unchecked shape a rule row actually has (the validated shape is assignable to
  it, so the union said nothing extra), and a string `params.value` is quoted in
  the rejection reason, since `"-2500"` and `-2500` otherwise produce the identical
  message and the second reads as a contradiction. The quoting came from the
  `e2e-tester`; the price comparison from the `impact-analyzer`'s final pass.
- Also fixed: three comments referred to `priceRow`, a symbol that lives only on
  the unmerged ingestion branch and that a reader of this branch alone cannot
  resolve.
- Verification of the fix: 30 tests pass at 100 % statement, branch, function and
  line coverage; `npm run lint` and `npm run typecheck` are clean and all four
  local agents were re-run.
- Closing fact, not a code change: the advisory review's last pass raised a
  Critical REVIEW.md 13.5 finding — `ADR.md` on this branch still describes the
  pre-reshape design, because the matching ADR-0004 and spec text lives on PR #35
  (`docs/promotion-rule-engine`, commit `09c9915`), which this PR is forbidden to
  edit. Resolved by retargeting PR #29's base branch onto
  `docs/promotion-rule-engine`, so the code can only reach `main` together with
  the ADR text that documents it.

### 2026-09-12 — Pricing core: the design moved again, so the module was reshaped again (issue #8, PR #29, PR #35, commit `c0c2701`)

- Supersedes the entry above in shape, not in fact: the `Adjustment` interface,
  `PercentBpsAdjustment`, `CentsAdjustment` and the event-typed registry behind
  `adjustmentFor(type)` no longer exist. Everything those entries record about
  the defects found along the way still happened and stays as written.
- Challenge: the advisory review raised a Critical REVIEW.md 13.5 finding — the
  module implemented an event-typed strategy registry while ADR-0004 and section
  4 of the design spec, on the branch this PR now targets (`docs/promotion-rule-engine`,
  PR #35), had moved on again to a named calculator resolved by a factory. A rule
  row now reads
  `{ type: 'applyDiscount', params: { calculator: 'PercentageDiscount', valueBasisPoints: 5000 } }`:
  the rule names the calculator, and the code no longer keys anything off the
  event type.
- Verification: the mismatch was found by reading the module against the design
  text on the base branch, not by any test — the module was internally consistent
  and fully covered while it was implementing the previous revision of the design.
- Resolution (commit `c0c2701`): `DiscountCalculator` is the interface
  (`validate`, `calculate`); `ValidatedDiscount` is the abstract base that holds
  what every calculator must not get wrong — parameters checked against the
  subclass's own schema, `bigint` arithmetic, the discount floored, the result
  bounded into `[0, baseCents]` — so a new calculator cannot reintroduce a
  rounding or clamping defect already fixed once on this branch, and cannot raise
  a price. `PercentageDiscount` (`valueBasisPoints`) and `FixedDiscount`
  (`valueCents`) are the two subclasses the case names, `CalculatorFactory.create(name)`
  resolves a name against the registry, and `applyPromotions(baseCents, event)` is
  the whole call site. Every failure — no calculator named, an unknown name,
  parameters the calculator rejects, an unusable base price — is a returned
  outcome carrying the base price and a reason, never a throw.
- Verification of the fix: the suite is 28 tests in total — 27 in
  `tests/pricing/effective-price.test.ts` and 1 in `tests/health.test.ts` — all
  passing at 100 % statement, branch, function and line coverage; `npm run lint`
  and `npm run typecheck` are clean and the local agents were re-run.
- Note on an earlier count, without rewriting it: the entry for commit `2719dd2`
  says "30 tests pass". That number is the suite total and includes
  `tests/health.test.ts`; the pricing file held 29 at that commit. The entry
  stands as written; counts from here on state both numbers, as this one does.
- Honest lesson: this is the second time in one pull request that the AI-written
  module was internally consistent, fully tested and approved by every local
  agent while being the wrong shape, and both times the correction came from a
  human reading the code against the design rather than from any automated gate.
  The first reshape replaced a `discountType` branch; this one replaced the
  registry that replaced it, because the design itself moved while the branch was
  open. A branch racing a design document is a process cost, not an accident:
  each revision of the text bought a full reshape of green, covered code. The
  mitigation used was to retarget PR #29's base onto PR #35's branch, so the code
  cannot reach `main` ahead of the text that documents it.

### 2026-09-12 — Pricing core: a failure carried a price, and rule params were loose (issue #8, PR #29, commit `108199a`)

- Two defects in the reshaped module, each found by the local agents and each
  raised independently by two of them.
- Challenge 1 — `PricingOutcome` carried `effectivePriceCents` on BOTH variants,
  including the failure one. A caller that read the field without checking `ok`
  would have published a product free the moment its base price was unusable:
  the worst available business outcome produced by the safest-looking line of
  code. The failure variant now carries only a reason, so the discriminated
  union forces every caller to branch — the storefront keeps the base price it
  already holds, ingestion treats it as a `rules` fault and stops the job.
- Challenge 2 — the calculators' zod schemas were `z.object`, which drops an
  unknown key in silence. A rule row is admin-authored data that no code review
  sees, so `valueBasisPoint` beside a valid `valueBasisPoints` would have kept
  pricing at the old value with no error anywhere (REVIEW.md 8.1). Both are
  `z.strictObject` now, with `calculator` folded in since it shares the `params`
  object, and a typo is a rejection naming the calculator.
- Verification of the fix: 29 tests in the suite, 28 of them in
  `tests/pricing/effective-price.test.ts`, at 100 % statement, branch, function
  and line coverage; `npm run lint` and `npm run typecheck` are clean and the
  local agents were re-run.
- Honest lesson: both defects are the same shape — a safe-looking default that
  hides a bad input rather than reporting it — which is the shape this pull
  request kept finding.

### 2026-09-12 — Pricing core: the third reshape in one pull request (issue #8, PR #29, PR #35, commit `12eaf94`)

- Supersedes the shape recorded above, not the facts: `applyPromotions(baseCents, event)`
  and the `DiscountEvent` wrapper no longer exist. Everything the earlier entries
  record about defects found along the way stays as written.
- Challenge: the merge at `64177c9` brought section 4 of the design spec forward
  again (PR #35). The calculator name is now a column, `promotions.calculator`,
  with its configuration in `promotions.params`, and the rule event no longer
  names a calculator — it names the winning level,
  `{ type: 'selectCandidate', params: { level } }`. The reason is the seeded
  largest-discount default: it has to compare two candidates' discounts, and a
  rule cannot compare candidates it never sees together, so the resolver computes
  each candidate's discount first and then runs the engine once over a fact set
  holding both.
- Resolution (commit `12eaf94`): `applyPromotions(baseCents, calculator, params)`
  now takes exactly what the promotion row carries. The `DiscountEvent` wrapper is
  deleted — its `type` was never read in this module, and the thing that reads a
  type is the resolver (issue #36). `params` stops carrying the calculator name,
  and the `event === null` "no rule fired" path went with the wrapper, since "no
  promotion applies" is the resolver's answer rather than a call into this module
  with nothing to apply.
- Unchanged: the `DiscountCalculator` interface, the `ValidatedDiscount` abstract
  base that owns schema validation, the bigint arithmetic, the floored discount
  and the `[0, base]` bound, the two calculators, the factory, `isActive`, and
  failures returned rather than thrown.
- Verification of the fix: 28 tests in the suite, 27 of them in
  `tests/pricing/effective-price.test.ts`, at 100 % statement, branch, function
  and line coverage; `npm run lint` and `npm run typecheck` are clean and the
  local agents were re-run.
- Honest lesson, a process one rather than a coding one: this branch is stacked on
  a design branch that is still moving, and each merge from that base can
  invalidate a signature the branch has already implemented and tested. Three of
  the four design mismatches in this pull request were found by the advisory
  review after the fact rather than by the branch noticing its own base had
  changed. The correction adopted is to diff section 4 against the module before
  every push, in the same commit, instead of after a review says so.

### 2026-09-12 — Pricing core: the abstraction did not match the domain (issue #8, PR #29, commit `1e624f5`)

- Supersedes every shape recorded above for this module, not the facts: the
  earlier entries describe calculators, a registry and a factory that no longer
  exist. They stay as written; they are dated history.
- Challenge: the owner settled the domain question on PR #29 at
  2026-09-12T16:48Z from the case text. A promotion is a domain row with a
  closed vocabulary — discount type, value, validity window — that only ever
  lowers a price and is bounded by `[0, base]`. Scenario A's dynamic pricing
  rules are application-layer, open-ended, and raise as well as lower in a
  chain. The shared calculator registry had merged the two, and the module's
  own comments had begun contradicting themselves about it: a shared registry
  with ingestion in one place, "a calculator can never raise a price" in
  another. Both could not be true. Issue #45, the planned shared-registry
  refactor, is void.
- Resolution (commit `1e624f5`, a fresh commit rather than a force-push so the
  review trail survives): `src/modules/promotion/promotion.ts` holds the
  `Promotion` type, `src/modules/promotion/effective-price.ts` holds
  `applyPromotion(basePriceCents, promotion)` and `isActive`. One pure function
  over a typed promotion row, integer `bigint` arithmetic, the discount floored,
  the result clamped into `[0, base]`, the `Number.isSafeInteger` guards, and
  failure returned rather than thrown. No abstract base, no factory, no
  registry, no `validate`: parameters are typed at the API boundary and by the
  check constraints, so nothing reaches this function unvalidated.
  `src/modules/pricing/` and `tests/pricing/` are deleted — that directory is
  Scenario A's alone and PR #39 owns it. Neither module imports the other.
- Two things the owner asked not to come back with the revert: comment density
  (the file is 52 lines with 6 of comment, down from 199 with 74 — the
  narrative those comments carried is in this appendix already, which is
  exactly why it could be cut), and one declaration per file, added to REVIEW.md
  as rule 8c.2 (then numbered 13.6) because the owner asked for it as a rule rather than a review
  comment.
- Verification of the fix: 21 tests in the suite, 20 of them in
  `tests/promotion/effective-price.test.ts`, at 100 % statement, branch,
  function and line coverage; `npm run lint` and `npm run typecheck` are clean
  and the local agents were re-run.
- Honest lesson: four design shapes were built in one pull request, and the last
  one is a revert to something close to the first. The three reshapes in between
  each followed a design document that was itself still moving, and each was
  validated green by the full agent set before the next change invalidated it.
  What no automated gate caught, in any round, was the domain question the owner
  settled from the case text in one paragraph — that a promotion and an
  ingestion pricing rule are different things and should not share an
  abstraction. Green checks measured internal consistency, not whether the
  abstraction matched the domain.

### 2026-09-12 — A retry loop that never retried, and a gate the SonarCloud UI could bypass (PR #56)

- Challenge: two findings in the same owner review of `scripts/sonar-issues.mjs`. (1) The retry loop wrapped only the `response.ok` check; `fetchImpl` throwing — an unreachable host (`TypeError`) or the 20 s `AbortSignal.timeout` firing (`TimeoutError`) — was not caught, so the one failure mode retries exist for propagated out of the function on the first attempt instead of being retried. (2) The gate queried `issues/search` with `resolved: 'false'` only; REVIEW.md 13.6 requires an ignore to go through an approved `sonar.issue.ignore.multicriteria` entry, but marking a finding Accepted, Won't Fix or False Positive from the SonarCloud web interface sets a resolution that drops it out of that same query, so the rule could be bypassed from the vendor UI with the gate still green.
- Verification: (1) `tests/sonar-issues.test.mjs` was written first with a stubbed `fetchImpl` that rejects on every call — the rejecting stub reproduces the original crash on the first attempt, and the same test now records ten attempts and the `::error::` line that says the job should be re-run. (2) Traced the SonarCloud issue-search API's `issueStatuses` parameter against the three resolution states REVIEW.md 13.6 names (Accepted, Won't Fix as its current name, False Positive) and confirmed no existing call queried them.
- Resolution: commit `737ea88` moved the `fetchImpl` call inside the same `try`/`catch` as the JSON parse, so a thrown error logs and retries exactly like a 5xx and the loop still ends with one `::error::` line after the attempt budget; added a second `issues/search` call with `issueStatuses=ACCEPTED,FALSE_POSITIVE` and a third call to `hotspots/search` for `status=TO_REVIEW` hotspots (which the issue-search endpoint never returns at all), each contributing to the same pass/fail total, so REVIEW.md 13.6 is enforced by the gate rather than left to reviewers to notice in the SonarCloud UI.

### 2026-09-12 — The two path patterns in `local-gates` disagreed (PR #46, `021de82`)

- Challenge: the first version of the path-based gating wrote the
  `e2e-tester` and `impact-analyzer` conditions as two separate regular
  expressions. The `impact-analyzer` one silently omitted `tsconfig*.json`,
  `Dockerfile` and the compose files, so a branch touching only a Dockerfile
  or the compose file would have been sent for a load run with no
  blast-radius trace — the wrong way round, since an infrastructure change is
  exactly the kind that lands on every branch at once. Both CLAUDE.md and
  CONTRIBUTING.md already promised “those same paths”, so the workflow
  contradicted the two documents shipped in the same commit.
- Verification: caught by the `impact-analyzer` round, which ran the two
  patterns against real paths with `grep` instead of reading them —
  `tsconfig.json`, `Dockerfile` and `docker-compose.yml` landed in the
  `e2e` bucket and not the `impact` one. The same probe confirmed
  `src/shared/db/migrations/0001.sql` and `vitest.config.ts` bucket
  correctly, and that no open pull request goes from passing to failing.
- Resolution: the path list became one shell variable used by both
  conditions, then — on the owner's second pass — two named variables,
  `behaviour` and `judgement`, that the prose in CLAUDE.md and CONTRIBUTING.md
  names verbatim. The resolved bucket for every representative path is
  tabulated in the pull request body, so a reader can check the rule without
  running it.

### 2026-09-12 — The e2e port-hygiene rewrite broke its own teardown (PR #44, `23dced4`)

- Challenge: the rewrite of `e2e-tester.md` replaced `npm run dev` with `npm start` to stop the agent orphaning servers, and justified it in the definition itself: "`npm start` is `node dist/server.js`: one process, one PID, `kill` ends it." On Windows that is false. `npm start` spawns `cmd.exe /d /s /c node dist/server.js`, which spawns node, so the PID the shell records is two levels above the listener. The instruction written to cure orphans reproduced them exactly.
- Verification: run, not reasoned about. The pre-push `e2e-tester` round followed the new definition literally on port 3148: after `kill $!` the listener was still in `netstat -ano` and `GET /health` still returned `{"status":"ok"}`; the survivor had to be reaped with `taskkill //PID <pid> //F //T`. A direct `node dist/server.js` launch on port 3149 was killed by `kill $!` and freed the port, which isolated `npm start` as the cause. Three smaller shell assumptions failed in the same run: `$!` is a Git Bash pseudo-PID that never equals the Windows listener PID; `node -e` does not resolve `/c/...` or `/tmp/...` mount aliases; and the definition's own `npm run build && PORT=... node dist/server.js &` backgrounds the whole `&&` list, so `$!` was the subshell and `kill $!` left node running until the build and the launch were split into two commands.
- Resolution: commit `23dced4` launches `node dist/server.js` directly, makes teardown fall back to killing the listener PID that step 4 already proved belongs to the run, and records both Git Bash facts in the Windows notes. The lesson generalises past this file: an instruction that names a command is a claim about a machine, and a self-referential agent definition is the one place where nobody else will run it before it ships.

### 2026-09-12 — A CI gate built, reviewed twice, then deleted (PR #56)

- Challenge: PR #56 was, for most of its life, a 130-line Node script
  (`scripts/sonar-issues.mjs`) that queried three SonarCloud APIs and failed the
  build on anything they returned. The gap it addressed is real: the free plan's
  quality gate judges ratings, coverage, duplication and hotspot review, so a
  CRITICAL code smell passes it — three sat on a green gate when this branch
  started, as commit `6a0a9c1` records. Two review rounds hardened the script (a
  retry loop that did not retry a thrown `fetch`; a bypass through the SonarCloud
  web interface). Neither round, AI or human, asked the prior question: does
  anything already say this?
- Verification: it does. SonarCloud posts its findings as a pull request comment
  without being asked, which is the same list the script was re-printing as
  GitHub annotations. The configuration alternative was examined rather than
  assumed, keeping what was verified apart from what was reported:
  `api/qualitygates/get_by_project` reports that the project uses the built-in
  Sonar way gate, and the owner then reported from the SonarCloud
  interface that creating a custom gate with an issue-count condition is a paid
  feature on this plan. That half came from the product's own screen rather than
  from an API, and the reviewer had recommended the custom gate before anyone
  checked what it cost — so the gate cannot be made to fail on findings. A
  third check found that every endpoint the script called answers anonymously on
  this public project: `issues/search`, the same call with `issueStatuses`, and
  `hotspots/search` each answer 200 with no credential. So
  the `SONAR_TOKEN` the script demanded was never needed — the AI wrote
  authenticated calls by default and two review rounds passed over the
  authentication without comment.
- Resolution: the script, its six tests, its ESLint globals block, its CI step
  and the `scripts/` directory were deleted. What the branch keeps is
  configuration and a rule: `sonar.qualitygate.wait=true` with a 300 s bound, the
  approved `plsql:S1192` ignore, the step that skips the scan when a pull request
  touches nothing under `sonar.sources`/`sonar.tests`, and REVIEW.md 13.6
  rewritten to say what is actually true — findings are read in SonarCloud's pull
  request comment and fixed before hand-off. Because that is a rule rather than a
  check, the obligation went into `.claude/agents/impact-analyzer.md`, which runs
  before every push, instead of into prose nobody executes; and 13.6 names that
  plan constraint, attributed to the owner, so the next reader does not spend an
  afternoon rebuilding what was just removed. `SONAR_TOKEN` stays on the scan
  step alone, where uploading an analysis genuinely needs it.
- Ratio note: this episode is the clearest case so far of AI-generated work being
  net negative until a human asked what the tool already did. The script was
  well-tested, well-reviewed and unnecessary; the value came from deleting it.

### 2026-09-12 — Pricing core: an error message named a unit that was wrong half the time (issue #8, PR #29, commit `a0d7277`)

- Challenge: `applyPromotion`'s second guard rejects a `value` that is not a
  whole positive number. It runs before the discount type is branched on, and
  `Promotion.value` is basis points for a `percentage` promotion and minor units
  only for a `fixed` one — the type's own doc comment says so. The AI-written
  message claimed minor units for both, so an operator debugging a rejected
  percentage promotion would have been told the wrong unit.
- Verification: read, not run — the defect is in a string, so no test could fail
  on it. It was found by reading the guard against `src/modules/promotion/promotion.ts`
  while checking the ADR's claim that the retired calculator shape is
  unconstructible. The test for that branch already described the check without
  a unit, so the message and its own test disagreed.
- Resolution, before and after:
  - before: `discount value ${promotion.value} is not a whole, positive number of minor units`
  - after: `discount value ${promotion.value} is not a whole, positive number`
- The check is unit-agnostic, so the message states no unit. The two messages
  that do name a unit keep it, because each sits behind a type check: the base
  price guard says minor units and the percentage ceiling guard says basis
  points. `tests/promotion/effective-price.test.ts` was updated in the same
  commit. 21 tests pass at 100 % statement, branch, function and line coverage.
- Lesson: the units convention is carried by one doc comment on a field and then
  restated in prose in three places. Every restatement is a copy that can go
  stale, and the guard that runs before the branch is the one place where no
  single unit is correct.

### 2026-09-12 — Pricing core: the revert took the code out and left the documents behind (issue #8, PR #29, commit `8001eb8`)

- Challenge, two findings in one round, both about prose rather than code. (1)
  The revert `1e624f5` deleted the calculator, factory and registry, but ADR-0004
  and the design spec kept describing them, so this branch merging after PR #35
  would have reinstated the sentences #35 removes — a revert that is green in
  every test and still restores what it reverted, one document later. (2) The
  precedence policy was stated as two opposite rules that were both called the
  default: "product level wins even when the category discount is larger" sat in
  ADR-0004 and REVIEW.md 7.4's edge case, while "whichever price is lower" sat
  in the rejected alternatives under its other name, "precedence by larger
  discount". The design spec stated it both ways in one document.
- Verification: an architecture review of the branch, plus a read of ADR-0004
  against the design spec's DDL rather than against the code. That second read
  is what caught the stale sentence, and it is also where the previous
  `docs-scribe` pass had gone wrong: the earlier report called ADR-0004 an exact
  match for the shipped module, because the module was the only thing it was
  checked against. The ADR's claim that the write store "still has `calculator
text` and `params jsonb`" was false in both directions — no migration exists
  on this branch, and the spec's `create table promotions` carries
  `discount_type` and `value` only, with no column for a later migration to
  drop.
- Resolution, the precedence half, before and after in ADR-0004:
  - before: the seeded default is product-level precedence, so a product's own
    promotion wins over its category's even when the category discount is
    larger; "whichever price is lower" is listed as rejected.
  - after: the seeded default applies whichever candidate prices lower, in the
    customer's favour, so a category flash sale deeper than a product's own
    promotion wins (owner decision, 2026-09-12); unconditional product-level
    precedence is the rejected alternative, because it would show a customer a
    worse price than the campaign advertises.
- The same sentence now appears once in each of ADR-0004's decision,
  consequences and rejected alternatives, REVIEW.md 7.4's promotion-inheritance
  edge case and section 4 of the design spec. The stale-shape half removed the
  `calculator`/`params` claim from ADR-0004, moved `effective-price.ts` from
  `pricing/` to `promotion/` in the spec's layout so it matches REVIEW.md 1.3
  and the tree, and dropped the guard comment in `effective-price.ts` that cited
  a zod boundary and check constraints as the real gates when neither has landed
  here.
- One cross-reference was wrong on both sides of the same sentence and is fixed
  here in ADR.md only: the ADR said the precedence policy is stated "with its
  consequence for admins" in section 3 of the design spec, but section 3 is the
  write-store schema; the statement is in section 4. The spec repeats the error
  about itself ("section 3 of this document"), which is outside this agent's
  files and is reported for routing rather than edited.
- Appendix history was left alone deliberately. The entries above that describe
  calculators, a registry and a factory, and the one that records
  product-over-category precedence as a tested case, stay in the past tense:
  this file is the case study's record of how the design moved, and rewriting it
  to match the current shape would delete the evidence the reflection depends
  on. Only the REVIEW.md rule number was corrected in place, 13.6 to 8c.2, with
  the old number kept in the sentence.
- Lesson, and the sharpest one in this pull request: a revert has a blast radius
  in prose that no test measures. Four reshapes of one module each updated the
  code and the design document, but the revert updated only the code, and the
  contradiction it left was invisible to lint, typecheck, 100 % coverage and the
  local agent set. It took a reviewer reading two documents against each other.

### 2026-09-12 — Pricing core: the policy reversal was applied in four places and missed four more (issue #8, PR #29, commit `b415ccc`)

- Challenge: the flip to lower-price-wins (`8001eb8`) changed the sentences that
  name the policy and left the sentences that describe its mechanism. ADR-0004's
  own decision paragraph still read "the product-level promotion if active, else
  the category-level one", contradicting the rejected-alternatives list 24 lines
  below it in the same file. REVIEW.md 7.4's cancel case said products with their
  own promotion are "left untouched" when a category promotion is cancelled —
  correct under product-level precedence, wrong now, because such a product was
  showing the category price and has to fall back to its own. 7.4's precedence
  case named no tie-breaker although the ADR breaks ties on the lower promotion
  id. The design spec's cancel walkthrough still ended "base prices restored",
  and its margin-floor bullet still called the default "the largest-discount
  rule".
- Verification: found by `architecture-critic`, the adversarial reviewer, in the
  second review round after the flip — not by the agent that applied it and not
  by this one. Worth recording why the docs pass missed it: the flip was checked
  by grepping the documents for the policy's names ("precedence", "larger
  discount", "product level wins"), and every one of the four survivors states
  the policy as a mechanism instead of by name, so no search term reached them.
  A grep for the old label cannot find the old behaviour described in different
  words.
- Resolution (`b415ccc`): ADR-0004's decision now reads "whichever active
  candidate prices lower, ties breaking on the lower promotion id, else none";
  REVIEW.md 7.4 gains the tie-breaker and states the cancel fallback as a return
  to the product's own promotion; the spec's walkthrough step 5 and its
  margin-floor bullet follow.
- Two decisions recorded in the same commit, both consequences of the flip
  rather than tidying:
  - A new ADR-0004 trade-off: the winning campaign is now a function of
    `base_price_cents`, so a vendor feed can change which promotion is credited
    with no admin action and no promotion mutation — a product-level fixed
    discount and a category percentage swap places once the base price moves far
    enough. Product-level precedence was stable under base-price changes; the
    lower price is not, which is what makes the margin-floor exception rule load-
    bearing rather than decorative.
  - ADR-0004 now names the database clock as the authority for which promotions
    are candidates (the resolution query's `tstzrange(starts_at, ends_at) @>
now()`), with `isActive` mirroring the same half-open window in TypeScript
    for a caller that already holds a row rather than being a second source of
    truth. The shipped `isActive` takes `now` as an argument, so the caller
    supplies the clock and the function cannot disagree with the query on its
    own.
- Lesson: a policy reversal is not a one-line edit. The flip passed its own
  consistency check, and the document it originated in still stated the rejected
  rule in the paragraph that matters most. The generalisable rule is to re-read
  the changed policy's mechanism, not its label — and that two documents agreeing
  on a name is not evidence they agree on the behaviour.

### 2026-09-12 — A reversal verified against a tree that had already moved (PR #35, `9cfdf12`, `c769001`)

- Challenge: the reconciliation commit `7105a12` was written against a branch
  head seven commits old, and every one of those seven commits (`5df9e6d`
  through `9bab6b9` locally, `b86c909` through `796c201` on the remote) _added_
  the design being reversed: the calculator registry, the factory, the
  strategy vocabulary and the largest-discount default. Merging origin/main
  (`9cfdf12`) and then the remote copy of this branch (`c769001`) brought those
  commits back. Conflicting hunks were resolved in favour of the reversal and
  were visible while resolving; the non-conflicting ones merged silently, which
  is exactly where the retired vocabulary survived.
- Verification: the stale-term sweep was re-run over the merged working tree
  rather than trusted from the first pass, with `git blame` on every surviving
  passage to attribute it to a commit. Three passages in section 4 of the
  domain spec still carry the retired reasoning, each blaming to a
  retired-design commit rather than to `7105a12`: "under the seeded default the
  one that prices lower is applied" and "that rule wins over the largest-discount
  rule" (both `4332243`), which contradict the product-level default the same
  section now states two bullets earlier, and "not to the strategies"
  (`09c9915`), which names the registry that no longer exists. The behaviour in
  each sentence reads plausibly; only the justification belongs to the replaced
  design.
- Resolution: in ADR.md, the consequence bullet claiming the write store "still
  has `calculator text` and `params jsonb`" was corrected — that half of the
  reversal had landed too, on PR #50 in `e48dee9`, which regenerated
  `0000_write_store.sql` with a `promotion_discount_type` enum and an integer
  `value`. Before: "only the first half has landed … the schema still has
  `calculator text` and `params jsonb`". After: both halves are written, each on
  an open pull request, with the commit named for each, and `main` carries
  neither. The spec passages are the owner's file and are reported to the
  coordinator rather than edited here. The lesson generalises: a reversal
  verified against one tree is not verified against a tree that moved, and the
  check that counts is the one run last — after the final merge, not before it.

### 2026-09-12 — The right method on the wrong premise (PR #35, `beba163`)

- Challenge: the previous pass changed the seeded default to product-level
  precedence, and the argument for it was a good one — REVIEW.md 7.4 and
  section 3 of the domain spec both said product level wins, the ADR said
  something else, and three documents against one is normally the answer.
  Citing the rulebook and the spec against the ADR is the correct method.
  It was applied to a premise nobody had checked: whether the rulebook was
  current. It was not. The owner's ruling reversed it and amended REVIEW.md,
  which is what an out-of-date rule is supposed to trigger.
- Verification: precedence had by then been stated three ways in one section
  (REVIEW.md 8c.6 records this as its evidence), so agreement between
  documents was never proof — the documents had been edited from each other.
  What settled it was the owner, not a further reading.
- Resolution, reusable: a rule cited as authority is only authority while it
  is current, and "three documents agree" is worth nothing when the three were
  copied from one another. When the documents disagree about a policy, the
  question goes to the owner as a decision, not to the documents as a vote.

### 2026-09-12 — A test that would have frozen a policy stored as data (PR #35, `beba163`)

- Challenge: the `architecture-critic` run objected that the rule layer earned
  nothing — if precedence is fixed and a test pins it, `json-rules-engine`,
  the `pricing_rules` table and the 60 s cache are ceremony around a constant,
  and the honest move is to delete the layer and hard-code the precedence.
  The objection was sound about the state it found; the planned suite did
  assert the seeded production default.
- Verification: the objection was tested by asking what a red build would mean
  after a production policy edit. Before: a test asserts that a product-level
  promotion beats a larger category one — so editing the seeded row turns CI
  red, and the policy cannot change without a code change. After: the test
  inserts the rule row it asserts against and checks the mechanism — given
  this rule, the engine selects this candidate — and no test in the suite
  names the seeded default. The seeded row is then editable in production,
  which is the property the layer exists for.
- Resolution: the layer stayed and the test changed. The principle is the
  sharper of the two from this round — a test that pins a policy stored as
  data is asserting configuration, not behaviour, and it removes exactly the
  freedom the data storage was bought for. It also decides which of the two
  the critic's objection was: not "the abstraction is unjustified" but "the
  test was cancelling the justification". Recorded in ADR-0004, REVIEW.md 7.4
  and section 4 of the domain spec.

### 2026-09-12 — The contradiction reappeared inside the commit that resolved it (PR #35, `b580f4a`)

- Challenge: `b580f4a` was the commit that adopted lowest-price selection across
  the documents. It did so in five places and wrote the retired policy — product
  level wins, so a 50 % category sale skips an accessory that carries its own
  promotion — into the sixth, section 4 of the domain spec. A commit whose
  message announces a policy is the last place a reader looks for the policy it
  replaces, which is precisely why it survived the author's own read.
- Verification: not by reasoning. Two independent reviews of the same diff
  (`docs-scribe` as a blocking finding, `architecture-critic` separately) each
  named the bullet; the author did not, on either pass. The rule holds that the
  sweep must run over the whole document after the edit, not over the hunks the
  edit touched — a stale-term search reads the file, a diff review reads the
  change, and a contradiction between an unchanged line and a changed one is
  invisible to the second.
- Resolution: the bullet now says the seeded rule applies whichever candidate
  prices the product lower, matching the other five places (`bc55689`). The
  reusable part: when a policy changes, the count of places stating it is the
  quantity to verify, and it is verified by searching for the old policy's words,
  not by re-reading the diff.

### 2026-09-12 — A scripted edit that matched nothing, and shipped (PR #35, `b580f4a` → `bc55689`, rule in `fd46829`)

- Challenge: the commit that fixed the finding above ran a Python edit whose end
  index came from `s.index("\n\n### Trade-offs")` — a heading that appears in

five of the seven ADRs — so the slice matched an earlier ADR and came out
empty, and `str.replace("", new)` inserts the replacement between every
character of the file. All seven ADRs became 249 copies of one bullet, and the
result was pushed, because the post-edit check asked whether the old text was
gone, which a file of 249 identical bullets passes.

- Verification and repair: `bc55689` restored ADR.md from `beba163`, the last
  commit before the destruction, and re-applied the two intended edits with
  anchors asserting a single occurrence. A restore from an earlier commit is
  where an unrelated edit gets silently reverted, so the restored file was
  diffed against `beba163` rather than eyeballed: the only differences are the
  two intended hunks in ADR-0004, both earlier corrections (the rules-cache
  bullet and the branch-scoped claim about `promotion.ts` in `1e624f5` and
  `0000_write_store.sql` in `e48dee9`) are present, and all seven ADRs carry
  their Context, Decision, Consequences, Trade-offs and Rejected alternatives.
- Resolution: REVIEW.md 13.7 (`fd46829`) requires a scripted edit to assert its
  anchor matches exactly once, with this failure as its evidence. The
  destruction is the loud version of a quieter bug that had already shipped
  twice on this project without being noticed: a replace that matches nothing
  reports success and ships a document contradicting its own commit message.
  The guard is asserting the match count; asserting presence, or asserting the
  old text is absent afterwards, catches neither form.

### 2026-09-12 — The coverage removed by a ruling had to land somewhere (PR #35, `b580f4a`)

- Challenge: dropping the test that pinned the seeded precedence (previous
  round, `beba163`) was right — it asserted configuration and froze a policy
  stored as a row — but it deleted real coverage: nothing then exercised the
  seeded rule set at all, and a seed that fires no rule, or a migration that
  ships a malformed condition, would have passed the suite.
- Verification: the gap was stated as a question — what breaks silently now that
  no test reads the seed? — and answered by naming the failure the removed test
  had incidentally caught.
- Resolution: section 4 of the domain spec names a case that loads the seeded
  rule set for a product with both a product-level and a category-level
  candidate and asserts that a winner exists, never which one. A seed that
  selects nothing fails; a seed edited from lowest-price to product-level still
  passes. The principle: a ruling that removes a test names the weaker assertion
  that keeps the mechanism covered, in the same round.

### 2026-09-12 - The reversal reached ADR-0004 and stopped there (PR #35, `8a95ea7` review)

- Challenge: the reversal round rewrote ADR-0004 and section 4 of the domain
  spec, and left two sentences elsewhere in ADR.md arguing the replaced design.
  ADR-0006 still listed "a `pricing_rules` layer for promotions" as a rejected
  alternative, which ADR-0004 now adopts for candidate selection, and ADR-0005
  still loaded ingestion rules from `pricing_rules` with no filter, written
  before the table gained the `type` column that made the unfiltered read load
  the promotion rules too.
- Verification: not a diff review - the diff of this branch never touched
  ADR-0005 or ADR-0006. The check that found it was reading every ADR that
  names `pricing_rules` after the edit, which is the same rule the destroyed-file
  round produced: search the document for the old policy's words, not the change.
- Resolution: ADR-0006's rejected alternative now says what is actually
  rejected - storing the promotions themselves as rule rows - and ADR-0005
  names `type = 'ingestion'`. Both in this pass. The reusable part: a decision
  reversal has to be swept across every ADR that cites the reversed one, because
  the contradiction lands in the ADRs the diff did not touch.

### 2026-09-13 — Two branches made the same correction, and the reconciliation was to drop this one's (issue #8, PR #29, PR #35, merge `50a350b`)

- Challenge: `origin/docs/promotion-rule-engine` had advanced thirteen commits
  and had performed the same lower-price precedence flip independently, in more
  depth, while this branch was flipping it in `8001eb8` and finishing it in
  `b415ccc`. Two agents corrected one policy in two documents at once. The merge
  took the base's `ADR.md`, `REVIEW.md` and design spec as they stand rather than
  replaying this branch's wording over them, so most of the prose those two
  commits wrote is superseded by the base's version of the same decisions. One
  ADR-0004 trade-off the base does not cover was kept: the credited campaign
  moves with `base_price_cents`.
- The substantive disagreement, and the base won it on the argument: this branch
  added a resolver-side tiebreak on the lower promotion id for an exact price
  tie. The base rejects it, because the exclusion constraints already guarantee
  at most one active candidate per level, so the tie is between a product
  candidate and a category candidate and the `<=` in the seeded
  `lower-price-product` rule decides it — a tiebreak in code would be a branch
  no test could reach. The branch that wrote the tiebreak had the same
  constraints in the same ADR and did not join them up.
- Pointers for the two entries above, which record decisions that still hold but
  quote wording the base has since rewritten. Neither entry is edited, for the
  same reason the 13.6-to-8c.2 number kept its old form in the sentence:
  - The `b415ccc` entry says ADR-0004's decision reads "ties breaking on the
    lower promotion id" and that REVIEW.md 7.4 gained a tie-breaker. Both are
    gone as of `50a350b`, deliberately, per the paragraph above. What survives
    from that entry is the half-applied-reversal finding itself and the two
    decisions it records.
  - The `8001eb8` entry records correcting ADR-0004's cross-reference to the
    design spec from section 3 to section 4. The base rewrote both paragraphs
    and the cross-reference no longer exists on either side, so there is nothing
    left to point at.
  - The same entry says the promotion write store "has not landed on this
    branch". Still true of this branch's code, but ADR-0004 now names
    `src/shared/db/migrations/0000_write_store.sql` on PR #50 (`e48dee9`) as the
    half that makes the retired shape unstorable, so the ADR's claim is about
    two open pull requests rather than about `main`.
- One finding fixed here rather than routed, because `ADR.md` is this agent's
  file: ADR-0004's rejected alternatives lost the product-level-precedence
  entry. The base's own appendix entry for `beba163` states that
  "precedence by larger discount" left that list because it is the seeded
  default under another name and that product-level precedence took its place —
  the first half landed on the base and the second did not, so the list named no
  alternative to the policy the ADR spends three paragraphs choosing. Restored
  as one line with the owner's reason. The wider point is that the base's
  appendix and the base's ADR disagreed about the base's own edit, and this
  merge is what made the two readable side by side.
- Lesson about parallel AI work, which is the reusable part: two agents given
  the same corrected policy and the same documents produced two defensible and
  incompatible texts, and the cost of reconciling them was larger than the cost
  of either edit. Nothing was wrong with the work on this branch except that it
  was done twice; the branch that owned the design document was the one whose
  version should stand, and this branch should have waited for it rather than
  correcting the same sentences in parallel. Merging a document is not merging
  code: there is no test that fails when two correct versions of a paragraph
  collide.

### 2026-09-13 — The story body still argued the reverted precedence policy (issue #8, PR #29, `08b5033`)

- Challenge: acceptance criterion 3 of issue #8 says the product-level candidate
  is applied whenever both a product-level and a category-level candidate exist.
  ADR-0004 has said the opposite since the owner's ruling of 2026-09-12: the
  lower effective price wins, with a higher-priority rule as the override. The
  case file was to be derived from the acceptance criteria, so a faithful
  derivation would have written the reverted policy into the repo's first e2e
  case file.
- Why nothing else would have caught it: an e2e case file is prose, not a test
  run. The implementation is already correct and its 24 unit tests are green, so
  lint, typecheck, coverage and the advisory review would all have passed with
  the case file asserting a rule the code does not implement — and the next
  person to write tests from it would have "fixed" the code to match.
- Verification: by reading, not by running. The criterion was read next to
  ADR-0004's decision and rejected-alternatives list before any case was
  written. Two source documents disagreed; the ADR carries a dated owner
  decision and the issue body predates it, so the ADR wins.
- Before / after. Before, from issue #8 criterion 3: given both a product-level
  and a category-level promotion, the product-level promotion is applied. After,
  case 8-3: "the candidate producing the lower effective price is applied, and
  its effective price is returned", with case 8-3b covering the product-level
  candidate winning when a higher-priority rule names the product level, and a
  note at the head of the file recording the divergence, its date and the ADR.
- Resolution: a story body is a snapshot of intent at filing time; where it
  disagrees with a dated ADR, the ADR wins and the divergence is stated in the
  derived document rather than resolved by silently following either source. The
  issue body itself is left untouched by this branch.

## Overall reflection

- Estimated ratio: pending.
- Key takeaway: pending.

### 2026-09-12 — Running estimate after the precedence round (PR #35, `beba163`)

- Share, documents only: prose is close to fully AI-drafted, but every
  decision in it is the owner's, and three of this round's four substantive
  changes (the precedence reversal, the no-test-on-the-default ruling, the
  capped-discount scope cut) originated with the owner against AI-written text
  that read as settled. The share that matters is not who typed the sentence
  but who owns the premise, and on this branch that was the human every time.
- Blind spot noticed: AI-written prose defends whatever it last wrote, so a
  reversal leaves sentences whose behaviour is corrected and whose "because"
  clause still argues the replaced policy. Two passes on this branch both
  found that class of defect after a merge, never before one.

### 2026-09-12 — Running estimate after the destroyed-file round (PR #35, `fd46829`)

- Share, documents only: unchanged in drafting — prose AI-written, decisions the
  owner's. What moved this round is the tooling around the prose: the edits
  themselves are scripted, and a scripted edit is AI-authored code operating on
  documents nobody diffs line by line, which is a category of AI output this
  appendix had not been counting.
- Blind spot noticed: verification that reads the intended change rather than
  the resulting file. Both failures this round — the contradiction left in an
  untouched bullet, and the 249-bullet file that passed its own absence check —
  were invisible to a diff review and obvious to anyone who opened the document.

### 2026-09-13 — Running estimate after the first e2e case file (issue #8, PR #29, `08b5033`, merge `50a350b`)

- Share, documents only: unchanged in drafting — prose AI-written, decisions the
  owner's. The case file is the first document on this branch drafted from a
  written requirement with the implementation deliberately out of context. Worth
  counting separately, because every other AI-written document here was drafted
  with the code in view, and prose written next to code tends to describe the
  code rather than the requirement.
- Blind spot noticed: stale inputs, as distinct from wrong output. This
  appendix has been treating an "AI mistake" as something the AI wrote wrongly;
  here the input was wrong and faithfulness to it was the failure mode. The
  2026-09-12 precedence reversal was swept across the ADRs, REVIEW.md and the
  design spec, but not across the open issues, and no agent in the pre-push set
  reads issue bodies for contradictions with a later decision.
