# AI appendix notes

Running source of truth for `Form 5_AI Appendix.docx`, maintained by the
`docs-scribe` agent before every push. Entries are appended and dated, never
rewritten.

## Tool manifest

| Model / Tool                      | Primary purpose                                                               | Effectiveness (1-5) and why |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Claude Code (Claude Fable 5.1)    | Infrastructure design, scaffolding, CI, agent definitions, TDD implementation | pending                     |
| Claude Code Action (subscription) | Advisory review on every pull request                                         | pending                     |
| Local agents (`.claude/agents/`)  | Pre-push e2e and impact verification, design critique, documentation          | pending                     |

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

### 2026-09-12 — Event contracts and BullMQ setup (issue #7, PR #37; behaviour in commit `829d6bb`, comments trimmed in `2c2e798`)

- Strategy: gave section 6 of `docs/superpowers/specs/2026-09-12-domain-design.md` (the event table, queue split, job defaults and boundary job ids) plus REVIEW.md as the contract, and asked for exactly that and nothing more — one zod schema and type per event, the `queueOfEvent` routing map, `createQueues` on Redis DB 1 with the agreed `defaultJobOptions`, and the deterministic `promo:{id}:{activate|expire}` job ids. No worker, no handler, no admin surface: those are later issues.
- Human refinement: two rules from REVIEW.md were turned from prose into enforced code rather than left as review checklist items — 3.4 (enqueue after commit) became the `withinTransaction` `AsyncLocalStorage` guard that makes `enqueue()` throw inside a transaction, and 7.3 (no mocks) kept the queue tests on a real Redis (`docker run -p 6399:6379 redis:7-alpine`) instead of an in-memory double. `now` is injected into `schedulePromotionBoundary` so one clock decides the delay (REVIEW.md 1.7).
- Follow-up in the same commit, after the `impact-analyzer` run: `removePromotionBoundaries` returns BullMQ's per-boundary removal code so a cancel racing a running activate is observable; `readmodel.rebuild.category` is trimmed because it becomes a `SCAN` prefix; `events.ts` gained a claim that the REVIEW.md 10.1 correlation id rides in the BullMQ job options, which the architecture-critic later found to be untrue and which was withdrawn in `3a3ec5f`; and `promotionBoundaryJobId` and `withinTransaction` carry comments naming their ceilings (retained completed job ids, opt-in transaction scope).

### 2026-09-12 — Comment density measured instead of argued (PR #37, REVIEW.md section 8b from PR #46)

- Strategy: PR #37's comments had already been trimmed once on taste (commit `2c2e798`). The owner instead had REVIEW.md grow a measurable rule — section 8b, comment density, severity Warning, on branch `docs/comment-density` (PR #46) — and asked for it to be applied to this branch's two source files before the two PRs meet. The prompt was the rule and the files, with no judgement call delegated: count comment lines against code lines, and for anything over the one-in-four target either delete the comment or state why it earns its line.
- Result: `src/shared/events.ts` went from 12 comment lines against 25 of code (48 %) to 5 (20 %); `src/shared/queue.ts` from 30 against 73 (41 %) to 19 (26 %). That is one line over the one-in-four target, which 8b.3 allows on appeal when every survivor is a contract, and the appeal is stated in the commit message: the logical-database split, the dead-letter set, the commit-ordering hazard and its ceiling, the write-once job id, the injected clock and the removal codes each say something no signature carries. The trim reached 18 first; the nineteenth line came back out of the `architecture-critic` run, which is also in this entry. The ten-line module docblock in `events.ts` retold section 6 of the design spec, so under 8b.2's last bullet it became a two-line pointer to `docs/superpowers/specs/2026-09-12-domain-design.md` plus the one thing the code cannot say (payloads are strict, so a field must be added to a schema before it can cross the queue boundary). Every contract survived in shortened form: the enqueue-after-commit reason and the opt-in ceiling on `withinTransaction`, the injected clock on `schedulePromotionBoundary`, and BullMQ's `1`-versus-`0` removal codes on `removePromotionBoundaries`, which the `Record<PromotionBoundary, number>` return type cannot carry. What went was what the code already said: a sentence restating a function's own name, "delayed until `at`, or immediate when that instant has passed" next to `Math.max(0, at - now)`, and "every payload is parsed at the queue boundary" next to the `parseEvent` call inside `enqueue`.
- Verification: the `architecture-critic` run on the trimmed branch caught three things the count alone could not. Shortening `schedulePromotionBoundary`'s comment to "so one clock decides, in tests too" had turned an invariant into a testing convenience and invited the next caller to pass `new Date()`; it now names PostgreSQL's clock, as ADR-0006 requires. `promotionBoundaryJobId` now says what ADR-0007 says and the old comment did not: scheduling is write-once per id and the returned `Job` describes the request, not what is stored. `removePromotionBoundaries` kept half a clause on why it is barred inside a transaction, because it is the sibling path most likely to lose the guard to a future cleanup. The one rationale left with no record anywhere — why payloads are validated at the producer rather than in the handler — moved to ADR-0003, which is where 8b.4 puts it. The critic's verdict on the branch was REVISE, on pre-existing design grounds unrelated to the comments (delayed jobs outliving an additive schema change, no connection timeout or queue-unavailable test, no `closeQueues` for `SIGTERM`), so `architecture-verified` was not re-applied after the push.
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
- Verification: caught by the advisory Claude review on PR #37; REVIEW.md rule 12.3 ("comments earn their line") had landed on main in the meantime and gave the same verdict independently.
- Resolution: commit `2c2e798` dropped the prefix and the comments that added nothing, keeping the ones that state a non-obvious fact or a shortcut's ceiling — the opt-in reach of the `withinTransaction` guard, the retained completed boundary job ids, and the meaning of BullMQ's removal codes. Comments only; no behaviour, signature, schema or job option changed.

### 2026-09-12 — Queue tests needed a Redis that CI did not have (issue #7, commit `829d6bb`)

- Challenge: the queue integration tests were written against a real Redis on port 6399 (no mocks, REVIEW.md 7.3) and passed locally, but `.github/workflows/ci.yml` ran `npm test` with no Redis at all. The whole integration suite would have failed on the first push, and the local-only green run had hidden it.
- Verification: caught by the `impact-analyzer` agent before push, which traced the new tests' runtime dependency against the CI job definition rather than only re-running the tests locally.
- Resolution: the CI job gained a `redis:7-alpine` service on 6399 with a `redis-cli ping` health check, so the same command runs against the same dependency locally and in CI; the README getting-started block documents the local `docker run` equivalent.

### 2026-09-12 — `local-gates` labels only existed by hand (PR #21, 846f04f, 465aac9)

- Challenge: the four verification labels (`e2e-verified`, `impact-verified`, `docs-verified`, `architecture-verified`) had only ever been created by hand in the repo's label set; `gh pr edit --remove-label` on a label that does not exist fails, so a fresh clone would break on the first `synchronize` strip. The fix step (`gh label create --force`) was first added to run unconditionally, over-creating the labels on every `labeled`/`unlabeled`/`reopened` event too.
- Verification: caught by the `impact-analyzer` agent reasoning through the workflow's `on.pull_request.types` list against the create step's `if` condition.
- Resolution: scoped the create step to `if: contains(fromJSON('["opened", "synchronize"]'), github.event.action)`, the only events that precede the strip step, so labels are created idempotently once per event that needs them instead of on every label change.

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

## Overall reflection

- Estimated ratio: pending.
- Key takeaway: pending.
