# AI appendix notes

Running source of truth for `Form 5_AI Appendix.docx`, maintained by the
`docs-scribe` agent before every push. Entries are appended and dated, never
rewritten.

## Tool manifest

| Model / Tool                                                  | Primary purpose                                                               | Effectiveness (1-5) and why |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Claude Code (Claude Opus 5 with 1M context; Claude Fable 5.1) | Infrastructure design, scaffolding, CI, agent definitions, TDD implementation | pending                     |
| Claude Code Action (subscription)                             | Advisory review on every pull request                                         | pending                     |
| Local agents (`.claude/agents/`)                              | Pre-push e2e and impact verification, design critique, documentation          | pending                     |

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

### 2026-09-12 — Event contracts and BullMQ setup (issue #7, PR #37; behaviour in commit `829d6bb`, comments trimmed in `2c2e798`)

- Strategy: gave section 6 of `docs/superpowers/specs/2026-09-12-domain-design.md` (the event table, queue split, job defaults and boundary job ids) plus REVIEW.md as the contract, and asked for exactly that and nothing more — one zod schema and type per event, the `queueOfEvent` routing map, `createQueues` on Redis DB 1 with the agreed `defaultJobOptions`, and the deterministic `promo:{id}:{activate|expire}` job ids. No worker, no handler, no admin surface: those are later issues.
- Human refinement: two rules from REVIEW.md were turned from prose into enforced code rather than left as review checklist items — 3.4 (enqueue after commit) became the `withinTransaction` `AsyncLocalStorage` guard that makes `enqueue()` throw inside a transaction, and 7.3 (no mocks) kept the queue tests on a real Redis (`docker run -p 6399:6379 redis:7-alpine`) instead of an in-memory double. `now` is injected into `schedulePromotionBoundary` so one clock decides the delay (REVIEW.md 1.7).
- Follow-up in the same commit, after the `impact-analyzer` run: `removePromotionBoundaries` returns BullMQ's per-boundary removal code so a cancel racing a running activate is observable; `readmodel.rebuild.category` is trimmed because it becomes a `SCAN` prefix; `events.ts` gained a claim that the REVIEW.md 10.1 correlation id rides in the BullMQ job options, which the architecture-critic later found to be untrue and which was withdrawn in `3a3ec5f`; and `promotionBoundaryJobId` and `withinTransaction` carry comments naming their ceilings (retained completed job ids, opt-in transaction scope).

### 2026-09-12 — Comment density measured instead of argued (PR #37, REVIEW.md section 8b from PR #46)

- Strategy: PR #37's comments had already been trimmed once on taste (commit `2c2e798`). The owner instead had REVIEW.md grow a measurable rule — section 8b, comment density, severity Warning, on branch `docs/comment-density` (PR #46) — and asked for it to be applied to this branch's two source files before the two PRs meet. The prompt was the rule and the files, with no judgement call delegated: count comment lines against code lines, and for every survivor either delete it or state why it earns its line under 8b.1.
- Result: `src/shared/events.ts` went from 12 comment lines against 25 of code (48 %) to 5 (20 %); `src/shared/queue.ts` from 30 against 73 (41 %) to 19 (26 %). No numeric threshold is claimed here — 8b.1 is a test each comment passes or fails, not a ratio — and the case for every survivor is stated in the commit message: the logical-database split, the dead-letter set, the commit-ordering hazard and its ceiling, the write-once job id, the injected clock and the removal codes each say something no signature carries. The trim reached 18 first; the nineteenth line came back out of the `architecture-critic` run, which is also in this entry. The ten-line module docblock in `events.ts` retold section 6 of the design spec, so under 8b.2's last bullet it became a two-line pointer to `docs/superpowers/specs/2026-09-12-domain-design.md` plus the one thing the code cannot say (payloads are strict, so a field must be added to a schema before it can cross the queue boundary). Every contract survived in shortened form: the enqueue-after-commit reason and the opt-in ceiling on `withinTransaction`, the injected clock on `schedulePromotionBoundary`, and BullMQ's `1`-versus-`0` removal codes on `removePromotionBoundaries`, which the `Record<PromotionBoundary, number>` return type cannot carry. What went was what the code already said: a sentence restating a function's own name, "delayed until `at`, or immediate when that instant has passed" next to `Math.max(0, at - now)`, and "every payload is parsed at the queue boundary" next to the `parseEvent` call inside `enqueue`.
- Verification: the `architecture-critic` run on the trimmed branch caught three things the count alone could not. Shortening `schedulePromotionBoundary`'s comment to "so one clock decides, in tests too" had turned an invariant into a testing convenience and invited the next caller to pass `new Date()`; it now names PostgreSQL's clock, as ADR-0006 requires. `promotionBoundaryJobId` now says what ADR-0007 says and the old comment did not: scheduling is write-once per id and the returned `Job` describes the request, not what is stored. `removePromotionBoundaries` kept half a clause on why it is barred inside a transaction, because it is the sibling path most likely to lose the guard to a future cleanup. The one rationale left with no record anywhere — why payloads are validated at the producer rather than in the handler — moved to ADR-0003, which is where 8b.3 puts it. The critic's verdict on the branch was REVISE, on pre-existing design grounds unrelated to the comments (delayed jobs outliving an additive schema change, no connection timeout or queue-unavailable test, no `closeQueues` for `SIGTERM`), so `architecture-verified` was not re-applied after the push.
- Human refinement: the owner set the threshold and the tie-break (link the spec section, never restate it), which is what turned a second round of the same subjective argument into a countable check. The test files measured at 0 % and 1 % and were left alone; their two comments are a runnable Redis setup command and a `@ts-expect-error` directive. No behaviour, signature, schema, job option or dependency changed; `lint` and `typecheck` are clean and `test:cov` passes 40 tests at 100 % statements, branches, functions and lines.

### 2026-09-12 — Queue operations bounded and closed on SIGTERM (PR #37, commit `497b4f1`)

- Strategy: the three findings the `architecture-critic` left open on the branch were handed over as the whole brief — REVIEW.md 3.11 (nothing closed the queues), REVIEW.md 7.4 "the queue unavailable", and delayed jobs outliving an additive schema change — with the instruction to close each or record it, not to file it. Measurement came before the fix: the ioredis settings that look like bounds were tried first, and `maxRetriesPerRequest`, `enableOfflineQueue: false` and `commandTimeout` were all observed still hanging past 6 s, while a capped `retryStrategy` bounds the call only by giving up reconnection permanently, which is worse for a long-lived producer. So the bound is explicit: 2 s around `enqueue` and boundary removal, with a matching `connectTimeout`, asserted by two tests landing at about 2 003 ms.
- Human refinement: `closeQueues` plus a SIGTERM path in `src/server.ts` that closes the HTTP server first and the queues last, because closing rejects an in-flight operation instead of draining it, so the producers have to stop first. Per-queue `error` listeners, because an `error` event with no listener is an uncaught exception, so a Redis blip took the process down; callers now learn from the bound instead. The schema-drift question stayed a question rather than acquiring a mechanism: it is an ADR-0003 trade-off plus issue #47, with what happens today written down.
- Verification: 43 tests, 100 % on statements, branches, functions and lines. The `architecture-critic` re-run on the branch returned REVISE, so `architecture-verified` was deliberately not applied after the push; the remaining findings sit with the owner rather than being closed in this commit.

### 2026-09-12 — Shutdown wait bounded, and a guard that could not fire deleted (PR #37, commits `5bc9125`, `a3f54b4`)

- Strategy: the third `architecture-critic` pass was handed the whole branch rather than the last diff, with the instruction to judge each mechanism by what it does on some real input, not by what its name promises. Two answers came back. `withinTransaction` and `assertOutsideTransaction` were deleted with their two tests: nothing ever entered the `AsyncLocalStorage` scope, so the assertion could not fire on any input, and a guard that looks like protection while providing none is worse than none, because the next reader trusts it. The rule it claimed to enforce (REVIEW.md 3.4, enqueue after commit) goes back to being carried by review, recorded in ADR-0003, and returns with its first real caller in issue #52. And `server.close` waits for every open connection with no bound, so `src/shared/shutdown.ts` caps the wait at `SHUTDOWN_TIMEOUT_MS` (10 s, overridable) and returns `'drained'` or `'forced'`; both paths are tested against a real server and real queues, no fake timers and no mocks (REVIEW.md 7.3).
- Human refinement: the single 2 s bound was split, `QUEUE_CONNECT_TIMEOUT_MS` (10 s) from `QUEUE_OPERATION_TIMEOUT_MS` (2 s), because a managed `rediss://` instance pays DNS and a TLS handshake once at connect while 2 s is the right bound for an operation on a socket already open. The missing queue-unavailable metric was recorded rather than invented: issue #53, linked from ADR-0003, and the observability story is not opened inside a queue PR. ADR-0003 also now names the forced-shutdown path as the enqueue-after-commit window under another name, rather than presenting it as a separate hazard.
- Verification: 43 tests, 100 % on statements, branches, functions and lines. The `architecture-critic` re-run returned REVISE on its third pass, so `architecture-verified` is again deliberately not applied; beyond what `a3f54b4` fixed it left nothing open on this PR, and that judgement sits with the owner.

### 2026-09-12 — The blank-timeout fix recorded, and the fourth architecture pass (PR #37, commit `5cbbb3e`)

- Strategy: documentation only, closing the gap the previous commit left. The appendix ended at `a3f54b4` and still described the superseded `Number.isFinite` parse as the current one, so it gained the entry for `6934952`: a parse that honoured a deliberate `0` but also accepted `Number('') === 0`, turning a set-but-empty `SHUTDOWN_TIMEOUT_MS` into an immediate forced shutdown — a fix worse than the bug it replaced, caught by the `impact-analyzer` and reproduced independently by the `e2e-tester`.
- Human refinement: a README sentence claiming `npm run dev` needs a Redis was corrected to what the process actually does — it starts and serves without one, logging connection errors, with each enqueue failing at its 2 s bound. Same class as the claims this branch has been withdrawing throughout: a plausible statement about behaviour that nobody had run.
- Verification: 51 tests, 100 % on statements, branches, functions and lines. The `architecture-critic` returned **SOUND** on its fourth pass over the branch, after three REVISE verdicts (`3a3ec5f`, the unguarded sibling producer; `497b4f1`, the overstated comments and the self-contradicting ADR; `5bc9125` with `a3f54b4`, the guard that could not fire and the unbounded shutdown wait), so `architecture-verified` applies to this branch for the first time.
- Carried forward as stated trade-offs, not open defects, each named in ADR-0003: consumer-side payload parsing does not exist yet, so a delayed job whose payload predates a schema change reaches the handler with the field absent rather than dead-lettering (issue #47); the enqueue-after-commit rule (REVIEW.md 3.4) is carried by review rather than by code and the runtime guard returns with its first real caller, the database module's `transaction()` helper (issue #52); and a queue-unavailable failure is not yet distinguishable from any other 5xx by a metric, which arrives with the logging and metrics story (issue #53).

### 2026-09-12 — Merging `main` up, and the process changes it brought (PR #37, merge commit `e753aca`)

- Strategy: the branch was merged up rather than rebased, so the PR #37 history stays readable next to the three `main` pull requests that landed beside it (`e0beddd` PR #56, `731c6df` PR #46, `9f780e8` PR #44, `838c193` PR #61). Each conflicted hunk was resolved by asking which commit introduced it and what it defends, not by taking a side.
- Human refinement: `main` changed the process while this branch was open, so the documents this branch owns were re-read against it. Branch protection now requires `ci` and `claude-review` only (`gh api .../branches/main/protection` reports exactly those two contexts); `local-gates` still runs and still prints the label set it computed, but no longer blocks a merge; the `pr-title` job is gone; and a review Warning is fixed in the pull request that finds it rather than filed as an issue. The README's merge paragraph said something else and was corrected. The same cleanup closed issues #47, #52 and #53 as not planned — #47 because it is a recorded ADR-0003 trade-off and not open work, #52 folded into #10 (the guard arrives with the product create endpoint), #53 folded into #18 (the metrics story) — so ADR-0003's three "tracked in issue" citations named closed issues and now name the story that carries the work instead.
- Verification: `npm run lint`, `npm run typecheck` and `npm run test:cov` on the merge result — 51 tests, 100 % statements, branches, functions and lines, Redis on 6399. The closed-issue claims were read from `gh issue view`, including the closing comments, rather than assumed from the issue numbers still appearing in the text.

### 2026-09-13 — Second merge of `main`, and the case file that did not survive it (PR #37, merge commit `a733763`; `8138581`)

- Strategy: merged up again rather than rebased, as at `e753aca`, so the PR history stays readable beside the four `main` commits that landed since (`c7748ed`, `e775ab6` PR #64, `3220916`, `53873fb` PR #35). Two files conflicted. README: both sides had rewritten the same three process bullets; `main`'s were taken whole (required checks `ci` and `claude-review`, `local-gates` non-blocking, the `needs-human-check` hand-off) and the one clause only this branch carried, that a review Warning is fixed in the pull request that found it, was re-added because CONTRIBUTING.md on `main` states exactly that and the README would otherwise have said less than the document it links. Appendix: both sides had appended to the usage and the judgement sections (this branch's PR #37 chain, `main`'s PR #35 entries); both kept in full, this branch's block first, nothing deleted, the same rule as last time.
- Human refinement: `docs/e2e-cases/7.md`, written on this branch by `test-case-generator` from issue #7's acceptance criteria (`73c35ad`), was deleted in `8138581` because the owner had ruled on `main` (`3220916`) that cases are the case study's user journeys, not the technical issues; the judgement entry for `73c35ad` records what was wrong with the file. The four journey files `main` added are kept. The tool manifest row for Claude Code was corrected in the same round: it named Fable 5.1 alone, while the co-author trailers in `git log` count 29 commits for Claude Opus 5 (1M context) against 10 for Fable 5.1.
- Verification: `npm run lint`, `npm run typecheck` and `npm run test:cov` on the merge result: 51 tests, 100 % statements, branches, functions and lines, Redis on 6399. ADR-0003, ADR-0006 and the README queue paragraphs were re-read against `src/shared/queue.ts`, `src/shared/shutdown.ts` and `src/server.ts` after the merge (2 s operation bound, 10 s connect budget, 10 s shutdown cap with `0` honoured, DB 1, `removeOnFail: false`, per-boundary removal codes, HTTP server closed before the queues), and `src/shared/events.ts` against section 6 of the domain spec, which `main`'s PR #35 rewrote around; no claim had gone stale. `main`'s rewrite of ADR-0006 (precedence decided by `json-rules-engine` rules) leaves this branch's two queue bullets there true: cancel still enqueues an immediate `promotion.changed` and the handler still runs at concurrency 1.

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

### 2026-09-13 — The fourth-pass findings applied, a third merge of `main`, and the branch re-read against two rules that became blocking (PR #37, `e6a1f2a`, `480c821`, `c557c13`)

- Strategy: three small rounds rather than one. `architecture-critic` had returned **SOUND** on the merged tree at `a733763` and still carried two findings; `e6a1f2a` applied both, against the tree rather than against the critique, so each claim was checked in the file it describes before the sentence was rewritten. `480c821` then merged `main` up again — the same merge-not-rebase choice as `e753aca` and `a733763` — for `79c56d6` (PR #66), which raised REVIEW.md 8b (comments) and 8c (one declaration per file, names match) from warning to **critical, blocking**, and rewrote the advisory review prompt to walk REVIEW.md and take each finding's severity from its section header instead of excluding structure by name. `c557c13` is this branch read against the two newly blocking sections.
- Human refinement: the rule change on `main` was not treated as a formality. Both of this branch's source files were read under 8b and 8c and one finding came out, fixed in `c557c13` (its own judgement entry below). The 8c reading was kept narrow and stated rather than assumed — one class, interface, abstract class or enum per file — because a wider reading (“one exported symbol per file”) would have split `src/shared/events.ts` between its schemas and the types inferred from them, which is the split REVIEW.md 8c.1 exists to prevent. Neither file declares any of the four; `src/shared/queue.ts` is one subject, the transport, at 141 lines.
- Verification: `architecture-critic` **SOUND** and `impact-analyzer` **PASS** on `a733763` (SonarCloud quality gate passed, 0 new issues, 100 % coverage on new code). On the head `c557c13`, `npm run lint`, `npm run typecheck` and `npm run test:cov`: 51 tests, 100 % statements, branches, functions and lines, Redis on 6399. `79c56d6` changed `REVIEW.md` and `.github/workflows/claude-review.yml` only, so the API table, the getting-started steps and the schema link in README.md need nothing for it, and ADR.md nothing except the contradiction the same round surfaced (below).

### 2026-09-13 — Two more critic passes on a documentation head, both on claims nobody had run (PR #37, `1359ff3`, `bfb8a6d`)

- Strategy: `architecture-critic` was run twice more after `4272b7f` and returned REVISE both times. Neither finding was new code; both are the defect class this branch keeps producing — a statement written down that nobody had executed or traced. Both rounds were answered as document changes, the only source edits being a deleted comment and a test teardown; no behaviour, signature, schema or job option moved.
- `1359ff3`: the deterministic boundary job id `promo:{id}:{activate|expire}` is legal only because bullmq 6.3.4 accepts a colon in a custom job id when the id splits into exactly three parts — a compatibility carve-out its own source marks for removal (`node_modules/bullmq/dist/cjs/classes/job.js:911`, whose comment reads "replace this check in next breaking check with include(':')"). After such an upgrade `enqueue` would throw, and it throws after the promotion has already committed. ADR-0007 now names the dependency, the failure and the `promo-{id}-{boundary}` escape, and says that the integration test asserting the literal id is the canary. The same commit closed three smaller gaps: the `cancelled_at` obligation existed only in ADR prose while the reconciler will be written from section 9 of the domain design, so sections 6 and 9 now carry it; the `src/server.ts` comment restating the `closeQueues` docblock one file over was deleted under REVIEW.md 8b.3; and the queue integration tests now obliterate both queues in `beforeAll` as well as `afterEach`, so a run killed mid-test cannot fail the next run's counts.
- `bfb8a6d`: the softening applied in `1359ff3` had stopped at the spec, so two ADRs still asserted an exception that is false for one input. Its own judgement entry is below. The same commit recorded what write-once job ids imply for a later branch: boundaries are immutable after assign, so editing a promotion's dates has to remove the jobs before re-scheduling.
- Human refinement: the second pass was asked for rather than the branch being assumed clean after the first, which is what found that one of four copies of the cancel exception had been softened and the other three had not.
- Open question, routed to the owner and not decided here: REVIEW.md 8c.2 and 8c.3 became critical and blocking in `79c56d6` (PR #66), and read literally this branch violates both. `src/shared/queue.ts` carries twelve exported declarations against 8c.2's "a second exported declaration in the same file is a finding", and none of `events.ts`, `queue.ts`, `shutdown.ts` is the `<subject>-<role>` kebab-case noun 8c.3 mandates. The critic's own fix is to amend the rulebook rather than split three files that are each one subject; that is the owner's call. Its sixth pass, on `bfb8a6d`, returned **SOUND** and narrowed the question: 8c.2 names `class`, `interface`, `abstract class` and `enum`, none of which these files declare, so what the owner is deciding is the broader sentence about a second exported declaration, not the enumerated rule. `architecture-verified` applies on this head.
- Verification: `npm run lint`, `npm run typecheck` and `npm run test:cov` on `bfb8a6d` — 51 tests, 100 % statements, branches, functions and lines.

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

### 2026-09-12 — A rule enforced on the path in mind, not on its sibling (PR #37, commit `3a3ec5f`)

- Challenge: the transaction guard was applied to `enqueue()` only. `removePromotionBoundaries()` is the same kind of write — an irreversible Redis mutation from inside a PostgreSQL transaction — and was left unguarded, so a cancel inside a transaction that then rolled back would have deleted the expiry job of a promotion that stayed active, leaving it discounted past `endsAt` until the reconciler's boundary sweep noticed. This is the characteristic AI failure mode here: the rule (REVIEW.md 3.4) was enforced on the path under discussion and not on the sibling path that needs it just as much.
- Verification: caught by the `architecture-critic` agent, which returned REVISE on the PR rather than reviewing only the lines the diff drew attention to. The same run also caught a code comment asserting that the REVIEW.md 10.1 correlation id "rides in the BullMQ job options" — a plausible-sounding claim about a library that had not been verified and was not true of anything in this repository.
- Resolution: commit `3a3ec5f` extracted `assertOutsideTransaction` and called it from both producers, with a test covering the removal path; the unverified comment was replaced with what is actually true (payloads are strict, so an id must be added to a schema before it can cross the boundary) and ADR-0003 now records correlation-id transport as undecided until the logger PR.

### 2026-09-12 — AI house-style comments passed off as repository convention (PR #37, commit `2c2e798`)

- Challenge: the queue code carried `ponytail:`-prefixed comments marking deliberate shortcuts. The prefix is a tool's own house style, not anything this repository had agreed on, and alongside it several comments restated the next line, narrated a function already named after what it does, or quoted a REVIEW.md rule number back at the reader.
- Verification: caught by the advisory Claude review on PR #37; REVIEW.md 8b.1 (a comment earns its line by saying something the code cannot) had landed on main in the meantime and gave the same verdict independently.
- Resolution: commit `2c2e798` dropped the prefix and the comments that added nothing, keeping the ones that state a non-obvious fact or a shortcut's ceiling — the opt-in reach of the `withinTransaction` guard, the retained completed boundary job ids, and the meaning of BullMQ's removal codes. Comments only; no behaviour, signature, schema or job option changed.

### 2026-09-12 — Queue tests needed a Redis that CI did not have (issue #7, commit `829d6bb`)

- Challenge: the queue integration tests were written against a real Redis on port 6399 (no mocks, REVIEW.md 7.3) and passed locally, but `.github/workflows/ci.yml` ran `npm test` with no Redis at all. The whole integration suite would have failed on the first push, and the local-only green run had hidden it.
- Verification: caught by the `impact-analyzer` agent before push, which traced the new tests' runtime dependency against the CI job definition rather than only re-running the tests locally.
- Resolution: the CI job gained a `redis:7-alpine` service on 6399 with a `redis-cli ping` health check, so the same command runs against the same dependency locally and in CI; the README getting-started block documents the local `docker run` equivalent.

### 2026-09-12 — `local-gates` labels only existed by hand (PR #21, 846f04f, 465aac9)

- Challenge: the four verification labels (`e2e-verified`, `impact-verified`, `docs-verified`, `architecture-verified`) had only ever been created by hand in the repo's label set; `gh pr edit --remove-label` on a label that does not exist fails, so a fresh clone would break on the first `synchronize` strip. The fix step (`gh label create --force`) was first added to run unconditionally, over-creating the labels on every `labeled`/`unlabeled`/`reopened` event too.
- Verification: caught by the `impact-analyzer` agent reasoning through the workflow's `on.pull_request.types` list against the create step's `if` condition.
- Resolution: scoped the create step to `if: contains(fromJSON('["opened", "synchronize"]'), github.event.action)`, the only events that precede the strip step, so labels are created idempotently once per event that needs them instead of on every label change.

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

### 2026-09-12 — A comment claimed a guarantee the library does not give (PR #37, commit `497b4f1`)

- Challenge: the comment on `closeQueues` said pending operations finish before the queue closes. BullMQ does not do that: closing tears down the connection under an in-flight `add`, which is then rejected. The claim was plausible for a "close" function and had not been checked against the library.
- Verification: writing the shutdown test properly proved the opposite — the in-flight `add` rejected rather than resolving. The same failure mode as the withdrawn correlation-id comment in commit `3a3ec5f`: an asserted library behaviour that nothing had verified.
- Resolution: the comment now states what closing actually does — in-flight work is rejected with its connection, and what it buys is the socket that would otherwise hold the event loop open — and `src/server.ts` orders shutdown around that fact, HTTP server first so the producers stop, queues last.

### 2026-09-12 — A timeout error overstated what it could know (PR #37, commit `497b4f1`)

- Challenge: the 2 s bound reported that the operation "did not reach Redis". The bound is a `Promise.race` against a timer and cancels nothing, so the command may still land after the timer fires. The message asserted an outcome the code cannot observe, and an operator reading it would have concluded that nothing was enqueued and that a manual replay was safe.
- Verification: read against the implementation — the losing promise is still running and is only caught to keep an unhandled rejection from killing the process, which is precisely the case the message denied.
- Resolution: the error now says the operation "did not confirm ... it may still land", and ADR-0003 records the same: the bound buys a fast failure, not a known outcome, and the reconciler converges either way.

### 2026-09-12 — ADR-0003 contradicted itself about who validates event payloads (PR #37, commit `497b4f1`)

- Challenge: ADR-0003 said payloads are validated by the producer rather than by the consumer, while the delayed-job trade-off written into the same ADR relied on a consumer-side parse to dead-letter a job whose payload predates a schema change. Both could not hold. `parseEvent` has exactly one call site, inside `enqueue`, so the dead-letter the trade-off promised could not happen: a stale delayed job would reach the handler with the new field simply undefined.
- Verification: every call site of `parseEvent` was grepped instead of the ADR sentence being taken at face value.
- Resolution: ADR-0003 now says both sides parse against the same schemas, that only the producer half exists today, and that the consumer half is the contract the event-handler PR has to honour, tracked with issue #47; the trade-off states the real present-day outcome rather than the intended one.

### 2026-09-12 — Shutdown told the operator the configured number, not the measured one (PR #37, commit `a3f54b4`)

- Challenge: two defects of my own, both found by the third `architecture-critic` pass and both the same class as the claims this branch had already withdrawn — a value asserted instead of observed. The shutdown log printed the configured bound on the forced path and a literal `0` on the drained one, so a drain that actually took nine seconds reported "Shutdown drained after 0 ms" and would have sent an operator hunting the delay somewhere else. And `SHUTDOWN_TIMEOUT_MS=0`, the one setting whose whole purpose is to force an immediate exit, fell through `||` to the 10 s default, so the knob silently did nothing.
- Verification: read against the code rather than against intent — the log interpolated a constant that no clock had touched, and `Number('0') || 10_000` is `10_000`. The zero case is the standard falsy-default trap, invisible in a test suite that only ever passes a positive timeout.
- Resolution: `src/server.ts` now stamps `Date.now()` before the wait and logs the elapsed difference. The override parse was fixed twice: `Number.isFinite` honoured a deliberate `0` but also accepted `Number('') === 0`, so commit `6934952` replaced it with the digits-only `parseShutdownTimeout` described below.

### 2026-09-12 — A fix that was worse than the bug it replaced (PR #37, `6934952`)

- Challenge: the `Number.isFinite` parse from `a3f54b4` turned `SHUTDOWN_TIMEOUT_MS=` — set but empty, the ordinary shape of a compose or Kubernetes env block, and of a blank line in an `env_file` — into a timeout of 0, so every `SIGTERM` took the forced path immediately and killed in-flight requests. The `|| default` form it replaced at least returned 10 s there, so the fix for one defect shipped a worse one.
- Verification: found by the `impact-analyzer` agent, which noted that the logic sat in `src/server.ts`, the one file excluded from coverage, so no test could fail on it. It then booted the real server per environment, held a half-sent request so `server.close` could never return, sent `SIGTERM` and read the process's own log: `''` forced after 4 ms before the fix, and waits the full 10 007 ms after it, while a deliberate `0` still exits in 17 ms. The `e2e-tester` reproduced the same defect independently on the previous head.
- Resolution: `parseShutdownTimeout` in `src/shared/shutdown.ts` accepts digits only, so a blank, non-numeric or negative value falls back to the default and `0` still means zero. It lives in a covered file precisely because the entry point is not, and all seven cases are tested along with the default-argument path nothing had exercised. The `SIGTERM` handler also catches a rejected shutdown and exits 1 rather than dying on an unhandled rejection.

### 2026-09-12 — Both sides of the conflicted CI file were partly right (PR #37, merge commit `e753aca`)

- Challenge: the branch was five commits behind `main` and `.github/workflows/ci.yml` conflicted. Either whole-side resolution loses something real. Taking this branch's file drops what landed on `main` in the meantime — the 15 minute job timeout, the step that skips the SonarCloud scan when a pull request touches nothing under `sonar.sources`/`sonar.tests` (`e0beddd`, PR #56) — and resurrects the `pr-title` job that `838c193` (PR #61) deleted, which would have reintroduced a job no branch protection asks for. Taking `main`'s file drops this branch's `services: redis` block on port 6399, without which the queue and shutdown integration tests have nothing to connect to, and REVIEW.md 7.3 forbids replacing it with a mock.
- Verification: the two files were diffed against each other rather than resolved by recency, and each block was traced to the commit that introduced it. `main`'s Redis-free CI was checked against this branch's test list: the queue and shutdown suites open real connections, so they fail without the service. The merged result was then run locally — `npm run lint`, `npm run typecheck`, `npm run test:cov`: 51 tests, 100 % statements, branches, functions and lines against Redis on 6399.
- Resolution: `main`'s version was taken as the base and the only thing re-applied on top was the `services: redis` block. `docs/ai-appendix-notes.md` conflicted the same way — `main` had appended entries for PR #56 and PR #46, this branch the PR #37 chain — and both were kept in full in both sections, `main`'s block first, with nothing deleted; an appendix that records history cannot resolve a conflict by choosing a side.

### 2026-09-13 — Test cases derived from a task had nobody in them, and named code that does not exist (PR #37, `73c35ad` → `8138581`)

- Challenge: `test-case-generator`, then instructed to write `docs/e2e-cases/<issue>.md` from an issue's acceptance criteria and never from the diff, produced 81 lines of cases for issue #7. Every case was a probe with "Actor: none", which the file itself admitted in its second paragraph, and the instruction not to read the implementation had a second cost: the cases asserted a catalogue at `src/shared/queue/catalogue.ts` and the events `promotion.created`, `promotion.assigned`, `promotion.activated`, `promotion.cancelled` and `promotion.expired`, none of which exist. The tree has `src/shared/events.ts` and one `promotion.changed` event (section 6 of the domain spec, ADR-0003). The agent did what it was asked; the ask produced a file that looked like coverage of a user story and was a restatement of the issue text, including the parts the issue got wrong.
- Verification: the owner's ruling on `main` (`3220916`, agent definitions in `e775ab6` PR #64): stories are tested, tasks are not, because the system does not come up without the task and that is the whole test. `docs/e2e-cases/README.md` on `main` names the per-issue files for #4, #7 and #8 as tasks dressed as stories and says they are gone, which this branch's copy of `7.md` contradicted the moment the merge landed. The event names were checked by grep against `src/shared/events.ts`.
- Resolution: `8138581` deleted the file; the four journey files from `main` are what `e2e-tester` runs here. The queue work of issue #7 appears in them only as a precondition ("the boundary scheduler" in `staff-runs-a-promotion.md`, measured as a boundary taking effect within 5 seconds), not as cases of its own. One consequence is routed rather than fixed here: `CLAUDE.md` and the `test-case-generator` row of `CONTRIBUTING.md` on `main` still say `docs/e2e-cases/<issue>.md`, which `3220916` made false.

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
  character of the file. All seven ADRs became 249 copies of one bullet, and
  the result was pushed, because the post-edit check asked whether the old text
  was gone, which a file of 249 identical bullets passes.
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

### 2026-09-12 — Two prices for one defective promotion (PR #35, `8a95ea7` → `b2ff55c`)

- Challenge: `architecture-critic` rejected `8a95ea7` with three findings, all
  in section 4 of the domain spec. The largest was a product whose own
  promotion cannot be priced having two stated outcomes. Before: the new bullet
  said an unpriceable candidate is absent to the rules, so `category-only`
  fires, while the older sentence left standing said the handler "logs it with
  the `promotionId` and writes the base price". One says a product in a 50 %
  category sale gets the sale price, the other says it stands at full price
  inside it, and a test written from either passes while the other is false.
  After: one sentence — the handler writes the price the surviving candidates
  resolve to, the base price only when no candidate priced.
- Verification: by the agent report, not by re-reading the diff. The
  contradiction was between a line the round added and a line it did not touch,
  which is the same shape as the two previous rounds: the correcting text was
  added in front of the text it supersedes instead of replacing it. Third
  occurrence of that habit on this branch; the older sentence is now rewritten.
- Resolution of the other two, same commit: `applyPromotion` no longer takes
  the promotion window, because `3a10c17` deliberately dropped
  `starts_at`/`ends_at` from the resolution query — the signature could only
  have been satisfied by re-adding two columns per candidate to a query that
  runs over 50 000 products per flash sale, and the query has already filtered
  to active promotions. And the silence counter added in `8a95ea7` was in no
  metrics list, so the failure it exists to catch stayed invisible; it is named
  `promotion_rules_no_event_total` in the section 12 metrics list.
- Blind spot this round adds: a metric named in one list is not yet observed.
  The counter is scraped but no alert rule in section 12 reads it, so nothing
  fires when it moves. Flagged, not decided here.

### 2026-09-13 — “The reconciler reconciles either way” was true for every boundary except a cancel (PR #37, `a733763` review → `e6a1f2a`)

- Challenge: `architecture-critic`'s largest finding on the merged tree. ADR-0003 justified the 2 s bound on queue operations with a sentence that disposed of its own worst case. Before: “The bound is a race that cancels nothing, so a timed-out operation may still land: it buys a fast failure, not a known outcome, and the reconciler reconciles either way.” The critic traced the claim into section 9 of the domain design and it does not hold for a cancel: the boundary sweep re-emits only for promotions whose `starts_at` or `ends_at` falls inside the watermark window, and a cancelled promotion has neither in it, so a cancel whose `enqueue` timed out after its PostgreSQL commit leaves a stale read-model hash that no sweep will touch. The product stays on sale in the storefront — exactly the Scenario B failure the queue exists to prevent — until something else notices.
- Verification: by reading section 9 of the spec and ADR-0007 against the sentence, not by re-reading the diff; the sentence and the sweep it relies on were written in different documents, on different days, and the diff of this branch never touched section 9. The convergence path that does exist was then traced rather than asserted: the reconciler's sampled price check (`max(50, 1 %)` of a category per run, capped at 500, ADR-0007) reaches the stale hash eventually, which is minutes rather than one period.
- Resolution: `e6a1f2a` rewrote the ADR-0003 sentence to say what happens — the reconciler reconciles either way “except after a cancel, where it does so only by sampling” — and named sweeping `cancelled_at` in the same window as the reconciler pull request's job, rather than claiming the gap away or widening this pull request to close it. The same commit corrected section 11 of the spec, whose `shared/` layout listed neither `events.ts` nor `shutdown.ts` although both exist, and did not say that `promotion/scheduling.ts` wraps the `shared/queue.ts` primitive with PostgreSQL's clock. In this docs round the correction was swept into ADR-0007, whose Consequences still claimed that any single failure converges within one reconciler period; it now carries the cancel exception and points at ADR-0003. That sweep is the rule from the 2026-09-12 reversal round applied on a smaller scale: a corrected claim has to be chased into the documents that repeat it, because the contradiction lands where the diff did not go.

### 2026-09-13 — A docblock that handed work to another pull request (PR #37, `c557c13`)

- Challenge: with REVIEW.md 8b blocking from `79c56d6` (PR #66), the `promotionBoundaryJobId` docblock in `src/shared/queue.ts` failed two of its clauses at once. It read “the reconciler PR has to re-emit `promotion.changed` with no job id instead”: an obligation on work that does not exist yet, which 8b.3 sends to ADR.md, stated in a place where 8b.5 bars it from being read as fact. The invariant it opens with — write-once per id, the returned `Job` describes the request and not what is stored — is the part only the comment can say, and that part stayed.
- Verification: the claim was checked against the document it belongs in before the comment was allowed to point there. ADR-0007's Trade-offs already carry it in full (“the reconciler's sweep re-emits `promotion.changed` with no job id”, citing `829d6bb`), so the pointer names a real sentence rather than a heading. `npm run lint`, `npm run typecheck` and `npm run test:cov` on the result: 51 tests, 100 % on all four metrics.
- Resolution: one line in `c557c13` — the sentence now ends “ADR-0007 says what the reconciler owes here”. The pattern worth keeping: when a rule turns blocking on `main`, the branch is read against it in its own commit, and the reading that found nothing is written down too. The 8c pass produced no structural finding and the commit message says on what reading, so the next reviewer disputes a stated criterion instead of guessing whether the section was checked at all.

### 2026-09-13 — A job id that works because of a deprecation notice (PR #37, `1359ff3`)

- Challenge: the boundary job id `promo:{id}:{activate|expire}` was chosen for Scenario B — one id per promotion and boundary, so a re-enqueue cannot double-activate — and nobody had read what bullmq does with a colon. It rejects custom ids containing `:` and exempts ids that split into exactly three parts; the exemption exists to keep old repeatable jobs working and its own source marks it for replacement with a plain `includes(':')` in the next breaking change (`node_modules/bullmq/dist/cjs/classes/job.js:911`). The format is therefore correct today by the width of a compatibility shim, and the failure on upgrade is the worst-shaped one available here: `enqueue` throws after the promotion row has committed, so the promotion exists and its activation never got scheduled.
- Verification: read out of the installed library's source at the pinned version rather than out of its documentation, and the exemption's arity checked against the id this repository actually builds (`promo`, id, boundary — three parts, so legal). Same class as the withdrawn correlation-id comment (`3a3ec5f`) and the `closeQueues` claim (`497b4f1`): an asserted library behaviour nobody had run.
- Resolution: not a rename. ADR-0007 names the dependency, the failure mode and the one-line escape (`promo-{id}-{boundary}`, which needs no exemption), and names the integration test that asserts the literal id as the canary that turns the upgrade into a red build rather than a silent production gap. Renaming now would churn a format that is correct at the pinned version; what was missing was the record, not the change.

### 2026-09-13 — Four copies of one exception, drifted into two claims (PR #37, `bfb8a6d`)

- Challenge: the cancel exception written in `e6a1f2a` was too strong, and the correction in `1359ff3` reached the domain spec and stopped. Before, in ADR-0003 and ADR-0007: a cancelled promotion has neither `starts_at` nor `ends_at` in the sweep window, so a cancel whose `enqueue` timed out converges only by sampling. That is false whenever the cancel happens within one reconciler period of the promotion's own boundary — that boundary is still in the window, so the sweep re-emits and the promotion does converge in one period. After, once, in ADR-0003: the sweep converges a cancel when its boundary still falls in the window, and only the cancel of a promotion whose boundaries are both outside it waits for the sampled price check; ADR-0007 and section 6 of the spec point at that sentence instead of restating it.
- Verification: by the `architecture-critic` pass on `1359ff3`, which read the ADR sentences against the spec section the previous round had already corrected — not by re-reading the diff, which showed a spec edit that looked complete. The count is the tell: four places stated the exception, two of them had been softened, and nothing in the branch's own review had asked how many copies existed.
- Resolution: one statement with the worst case named, in ADR-0003, and pointers elsewhere. The reusable part is the same rule this branch produced twice already, applied to its own correction: the copies of a claim are the quantity to verify, and a correction is not finished until it has been chased into every document that repeats it. This is the third round where the contradiction lived in a line the diff did not touch.

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

### 2026-09-13 — Running estimate after the queue branch's rule-change round (PR #37, `e6a1f2a` → `c557c13`)

- Share on this branch: code roughly four-fifths AI-written against human-set contracts (the event catalogue, the bounds, the shutdown order), documents almost entirely AI-drafted. What the last three rounds moved is smaller and worth stating precisely — every correction since `a733763` came from an agent or a rule rather than from the author re-reading their own text: the critic found the cancel gap, `main`'s rule change forced the comment finding. Self-review found neither.
- Blind spot noticed: a justification sentence that ends in a general reassurance (“the reconciler reconciles either way”) is where AI prose hides an unchecked case, and it survives review because it reads as a conclusion rather than as a claim. Both the destroyed-file round and this one were caught by reading the document the sentence depends on, never by reading the sentence.
- Second blind spot, carried not closed: a rule that is a warning is a rule that does not exist. 8b and 8c were on the books while this branch shipped comments that violated 8b, and only the severity change on `main` produced the pass that found them.

### 2026-09-13 — Running estimate after the fifth and sixth critic passes (PR #37, `1359ff3`, `bfb8a6d`)

- Share on this branch: unchanged in drafting — code roughly four-fifths AI-written against human-set contracts, documents almost entirely AI-drafted. Six `architecture-critic` passes have now run on this branch and five returned REVISE; every finding of the last four was a claim the author had written confidently and never executed (the correlation id in the job options, `closeQueues` draining, the reconciler converging a cancel, the colon in a bullmq job id). The human contribution that shows in the record is not prose but the decision to run another pass on a head that already looked finished.
- Blind spot noticed: a correction is treated as done at the document it was reported against. `1359ff3` fixed the spec and left the same sentence wrong in two ADRs, which is the correction itself repeating the defect it was fixing. Counting the copies before editing any of them is now the cheap check, and nothing in the process asks for it.
- Second blind spot: a dependency's behaviour is read from its documentation and its own tests are never opened. The job-id carve-out was visible in one line of installed source at the version this repository pins, and it took a critic pass rather than the round that chose the format.
