# AI appendix notes

Running source of truth for `Form 5_AI Appendix.docx`, maintained by the
`docs-scribe` agent before every push. Entries are appended and dated, never
rewritten.

## Tool manifest

| Model / Tool                      | Primary purpose                                                               | Effectiveness (1-5) and why                                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (Claude Fable 5.1)    | Infrastructure design, scaffolding, CI, agent definitions, TDD implementation | 4 — fast and accurate on structure and tests, but defaults to trusting input that arrives via infrastructure and to a library option whose name matches the requirement (see the `x-request-id` and `redact` entries)                                     |
| Claude Code Action (subscription) | Advisory review on every pull request                                         | 3 — catches contract and consistency problems reliably; re-analysed the whole diff on every push until the workflow was changed to review only new commits (PR #23)                                                                                       |
| Local agents (`.claude/agents/`)  | Pre-push e2e and impact verification, design critique, documentation          | 4 — `impact-analyzer` and `architecture-critic` found the highest-value defects (the `local-gates` masked failure, the REVIEW.md rule that contradicted ADR-0006, five structural errors in the first architecture) before any of them reached a reviewer |

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

### 2026-09-12 — HTTP skeleton (issue #6, branch `feat/http-skeleton`)

- Strategy: gave the issue's acceptance criteria plus `REVIEW.md` (§6.6 per-request work, §8.1 boundary validation, §8.3 error shape, §8.4 no internal detail escapes, §10.1/§10.3 logging) and the already-approved ADRs as context, and asked for the four pieces (validation helper, error handler, logger, `AppError`) one failing test at a time rather than as a single scaffold. Each piece was specified by the behaviour it had to produce (status/code table, strict-schema rejection, correlation-id echo), not by the code shape.
- Human refinement: three AI defaults were rejected and replaced — the untrusted `x-request-id` header, `redact` as the credential defence, and a wrong test expectation about zod 4's unknown-key path (all three recorded below). The owner also required the unexpected-500 stack to be logged, which `REVIEW.md` §8.4 read as forbidding; the rule itself is amended in this PR to scope it to the client-facing response, and ADR-0008 records why, so the next reviewer does not re-open it.

### 2026-09-12 — HTTP skeleton review round (PR #30)

- Strategy: instead of asking for a general review, ran the advisory Claude review and the `architecture-critic` agent on the committed diff with `REVIEW.md` and the ADRs as the standard, and required each finding to name the rule it breaks or the design statement it contradicts. Findings were collected and fixed in one commit after the run finished, per the severity policy in `CONTRIBUTING.md`.
- Human refinement: the owner adjudicated the two findings where the rulebook itself was wrong rather than the code — `redact` was deleted outright instead of being kept as "defence in depth" (a control that cannot fire is worse than none, because it reads as coverage), and REVIEW.md §8.4 was rewritten to separate the client-facing response from the log line, since the previous wording forbade the stack that issue #6 requires. Three further findings were accepted as written: the `res.headersSent` guard, `.strict()` being top-level only (recorded as a convention with a test), and the two module-level `AppError` singletons becoming plain data so one Error object is not shared across concurrent requests. SQLSTATE `23P01` was deliberately left unmapped in the middleware — ADR-0008 now records `AppError` as the seam and the promotion handler as the owner of that mapping, so the next reviewer does not re-open it.

### 2026-09-12 — Second review round on the HTTP skeleton (PR #30, commit `e46f14b`)

- Strategy: re-ran the advisory Claude review and the `architecture-critic` agent on the committed diff, but this time asked the agent to check the error-logging whitelist against the **installed** `drizzle-orm` 0.45 in `node_modules` rather than against the shape the previous round had assumed. The same run was asked to assert what a 500 log line MUST contain, not only what it must not, which is what exposed the pino-http serializer trap. Findings were fixed in one commit after the run finished, per the severity policy in `CONTRIBUTING.md`.
- Human refinement: the owner required the log form itself to become a rule rather than a habit, so `REVIEW.md` 8.4 now states that an error reaches a log through `serializeError` under an `error` key and that handing a logger the error itself, under any key, is a finding. The owner also deferred `SIGTERM` draining deliberately and had it recorded as a stated gap in ADR-0008 instead of implemented in a skeleton, and had the comments across `src/` trimmed against the new REVIEW.md 12.3.

### 2026-09-12 — Third review round on the HTTP skeleton (PR #30, commit `c6e4ff2`)

- Strategy: the round before had asked the agent to check the whitelist against the installed `drizzle-orm`; this one extended the same instruction to `express` and `body-parser`, and asked what each library writes or answers **by default** on the paths the code delegates to. That is what surfaced Express's `logerror` (raw `err.stack` to stderr on every env except `test`) and body-parser's actual statuses. A probe test was written before the mapping changed, to find out what the installed parser answers rather than to assume. The probe was itself wrong — see the fourth round below — which is the more useful lesson: it set `content-encoding` and never a charset, then its result was quoted in an ADR as though it had tested both.
- Human refinement: `415` was dropped on the probe's evidence, which the next round reversed; decided the open `res.headersSent` question in favour of `res.destroy()` over a terminal handler of our own, because it removes the second place the error can escape rather than adding one more place to get right; and had REVIEW.md §8.4 reworded to read as a general rule naming one shared implementation, rather than as a description of this PR.

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

### 2026-09-12 — Correlation id trusted an untrusted header (issue #6, branch `feat/http-skeleton`)

- Challenge: the first draft took the incoming `x-request-id` header verbatim as the request id. The header is unauthenticated client input, so a value containing a newline forges whole log lines (an attacker writes a fake "request completed" entry, or buries a real one) and a value containing CR injects a response header, since the same value is echoed back as `x-request-id`.
- Verification: traced both sinks the value reaches — the log line and `res.setHeader` — and confirmed neither pino nor Express sanitises it; covered by tests that send a malformed header and assert both the response header and the logged `reqId` are a generated uuid instead.
- Resolution: before, the id was `req.headers['x-request-id'] ?? randomUUID()`. After, the header is accepted only when it matches `^[A-Za-z0-9._-]{1,128}$`, otherwise a `randomUUID()` is used, and the id that is bound and echoed is always the validated one. Recorded as a decision in ADR-0009.

### 2026-09-12 — `redact` mistaken for a logging privacy control (issue #6, branch `feat/http-skeleton`)

- Challenge: the first draft satisfied "credentials never reach a log line" (REVIEW.md §10.3) with pino's `redact` option listing `authorization`, `cookie` and `x-api-key`. Two gaps: redaction paths apply to the logger instance they are configured on rather than to every derived child, and even where they do apply they mask three named headers while pino-http's default serializer still logs the full header set, the query string and the request body — so every other header, a token in a query parameter, and any personal data in a payload were still written.
- Verification: inspected the log lines actually captured in tests instead of trusting the option's name; the captured lines contained the whole `headers` and `query` objects.
- Resolution: narrowed the serializers so those fields are never serialised at all — `req` to `{ id, method, path }`, `res` to `{ statusCode }`. `redact` was kept alongside them at first, until the advisory review on PR #30 pointed out that it can only mask paths the serializer has already removed: it was dead weight reading as a second control, so it was deleted. Recorded in ADR-0009 together with the rejected alternative.

### 2026-09-12 — Wrong test expectation about zod 4 unknown keys (issue #6, branch `feat/http-skeleton`)

- Challenge: a test asserted that a strict schema reports an unrecognised key under that key's own `path`. Zod 4 reports `unrecognized_keys` at the object root, naming the offending key in the message.
- Verification: ran the assertion against zod's real output rather than changing the middleware to satisfy the test — the failure was in the expectation, not in the code under test.
- Resolution: corrected the test expectation. Worth recording because the tempting fix (re-mapping the issue onto a synthetic path inside `details()`) would have added production code to make a wrong assumption true.

### 2026-09-12 — An error object logged as itself leaks the SQL statement and the request body (PR #30)

- Challenge: the unexpected-500 path logged `req.log.error({ err })`. pino's default error serializer writes an error's own enumerable fields, and a Drizzle/pg error carries `query` (the failing SQL text), `params` (the bound parameters), `detail` and `where` — so the first database failure on a promotion or ingestion route would have written the customer data from the request body into a retained log. The AI had treated "the stack is allowed in a log" as settling the question and never asked what else an ORM error carries; REVIEW.md §8.4 as written ("no internal detail escapes") was read as being about the response only, so nothing flagged it.
- Verification: caught by the `architecture-critic` run on PR #30, then confirmed against a driver-shaped error in a test that asserts the captured log line has no `query` and no `params` key (`tests/error-handler.test.ts`).
- Resolution (before/after): before, the root logger had no `err` serializer and the handler logged the error object. After, `src/shared/logger.ts` defines `serializeError` emitting `{ type, message, stack, code }` and nothing else, wired into the pino-http `serializers` map, so the whitelist applies to every `err` logged anywhere in the process — **superseded in the same PR**: pino-http wraps a custom `err` serializer around pino's own, so that wiring fed it an already-flattened object; the call site now passes `serializeError(err)` under an `error` key, as the entry below records. REVIEW.md §8.4 was amended in the same PR — as its own preamble requires when a rule and the design disagree — to scope "no internal detail escapes" to the client-facing response and to forbid SQL text, bound parameters and secrets in logs while allowing a stack, ending with "logging an error object directly is a finding". Recorded in ADR-0009 and cross-referenced from ADR-0008.

### 2026-09-12 — The error handler assumed nothing had been written yet (PR #30)

- Challenge: the error handler always answered with `res.status(...).json(...)`. If a handler fails after a partial write, the headers are already sent: Express throws `ERR_HTTP_HEADERS_SENT`, or an error envelope is appended to a half-written body, which a client parses as corrupt JSON. The AI assumed the error handler always runs before the first byte, which holds for today's routes but not for the streamed listing ADR-0006 anticipates.
- Verification: caught by the advisory Claude review on PR #30 and reproduced with a test that writes part of a response and then calls `next(err)`.
- Resolution: the handler now checks `res.headersSent` first, logs the error and delegates to Express's final handler, which destroys the connection — a truncated body rather than a complete one with an error appended. Written into ADR-0008 as "the envelope holds only before the first byte", with the rule that a future streamed listing treats a mid-stream failure as a broken connection.

### 2026-09-12 — An edit that silently did not apply (PR #30)

- Challenge: the `redact` removal was reported as done but the edit had not been written to `src/shared/logger.ts`. The follow-up reasoning was all built on the assumption that the file already matched the decision.
- Verification: caught only because the reviewer read the committed file rather than the change summary. No test could have caught it: `redact` was dead configuration, so removing it changes no observable behaviour.
- Resolution: the option was deleted for real, and the lesson is a process one — a change is verified by re-reading the resulting file (or by a test that fails without it), never by the tool's own report that it succeeded.

### 2026-09-12 — The whitelist written against an imagined error shape still leaked (PR #30, commit `e46f14b`)

- Challenge: the previous round replaced `req.log.error({ err })` with a `{ type, message, stack, code }` whitelist and treated the leak as closed. It was not. `drizzle-orm` 0.45 builds `DrizzleQueryError`'s message as `` `Failed query: ${query}\nparams: ${params}` ``, and the first line of a stack repeats the message — so keeping `message` and `stack` kept the failing statement and the customer's row on the log line, which is exactly what the whitelist existed to remove. The whitelist had been written against a plausible-looking error shape, not against the library actually installed.
- Verification: the `architecture-critic` agent read the installed `drizzle-orm` 0.45 source in `node_modules` and quoted the `super(...)` call that composes the message; the test then asserts on a real `DrizzleQueryError` that the captured line carries neither the SQL text nor the parameter values.
- Resolution (before/after): before, `serializeError` returned the error's own `name`, `message`, full `stack` and `code`. After, `type`, `message` and `code` are taken from the error's `cause` — the driver error names the constraint and carries the SQLSTATE, but not the values — and `stack` is filtered down to its `at ...` frames, dropping the message line. ADR-0009 now names the library version the whitelist is written against.
- Lesson: "log a whitelist" is only a safety claim relative to a concrete, versioned error shape. A list of field names chosen without reading the producer of those fields is a guess with the appearance of a control.

### 2026-09-12 — A fabricated fixture certified the leak it was written to catch (PR #30, commit `e46f14b`)

- Challenge: the test that proved "no `query`, no `params` on the log line" used a hand-built error object shaped the way the AI imagined a driver error looks. The real `DrizzleQueryError` puts the statement in the message and repeats it in the stack, which the fixture did not, so the test passed against the leaking implementation and would have kept passing for as long as the leak lived.
- Verification: the `architecture-critic` compared the fixture with the constructor in the installed library and found no code path that produces that shape.
- Resolution: `tests/error-handler.test.ts` now constructs the real `DrizzleQueryError` from the dependency, so a version upgrade that changes the shape fails the test instead of silently invalidating it. The reviewer's rule, adopted: a fixture modelling a shape no dependency produces is worse than no test, because it converts an open question into a green check.

### 2026-09-12 — A test that passed for the wrong reason (PR #30, commit `e46f14b`)

- Challenge: the test for nested strictness sent a payload that omitted a required field. It was green because the nested object failed validation for the missing field, so it would have stayed green with a non-strict nested schema — it asserted nothing about `z.strictObject` at all.
- Verification: REVIEW.md 14.5's question — which test would fail if I inverted this condition — applied to the assertion: swapping `z.strictObject` for `z.object` left the suite green.
- Resolution: the payload is now complete with exactly one misspelled field, so the only reason to reject it is strictness. The convention itself (strictness is top-level only) is recorded in ADR-0008 and in the `validate` JSDoc, since the test alone cannot state it.

### 2026-09-12 — A safety measure silently destroyed the diagnosis it was meant to preserve (PR #30, commit `e46f14b`)

- Challenge: `serializeError` had been installed as a custom `err` serializer in the pino-http `serializers` map. pino-http wraps a custom `err` serializer around pino's own, so the same function received an already-flattened plain object through `req.log` and a real `Error` through the root logger. The flattened object is not an `instanceof Error`, so every 500 logged through `req.log` — the only path that matters — came out as `{"type":"object"}`: no message, no stack, no SQLSTATE. The privacy fix had quietly removed the diagnosis the stack exists for.
- Verification: caught only because the agent asserted what the log line MUST contain (an error type, and frames pointing at the throwing module) and not only what it must not contain. Every "no `query`, no `params`" assertion passed happily on an empty object.
- Resolution: the `err` key is abandoned; errors are logged under an `error` key with `serializeError` called explicitly at the log site, one key and one shape everywhere including the workers. A thrown non-`Error` now logs its type and never its value. REVIEW.md 8.4 requires that form, so the next reviewer does not re-introduce a serializer.
- Lesson: a negative assertion alone cannot tell "the secret is gone" from "everything is gone". Each redaction test needs a positive twin.

### 2026-09-12 — The framework's own error printer leaked what the whitelist removed (PR #30, commit `c6e4ff2`)

- Challenge: after `res.headersSent` the error handler logged through the whitelist and then called `next(err)`. Express's final handler writes the raw `err.stack` to stderr on every environment except `test` — the one the suite runs in — so the statement and the bound row reached production logs while every test stayed green. This is the second time in this PR that a green test covered a leak.
- Verification: the `architecture-critic` agent read `logerror` in the installed `express/lib/application.js` and quoted the `NODE_ENV !== 'test'` guard, which also explains why no test could have caught it.
- Resolution (before/after): before, `if (res.headersSent) { log; return next(err); }`. After, `if (res.headersSent) { log; res.destroy(); return; }` — the client sees the same truncated body, and the error is never handed to Express. ADR-0008 records socket destruction as the decision and its trade-off (an unexplained connection reset) in place of the sentence that called the fix undecided.

### 2026-09-12 — A whitelisted field is not a safe field: the message composes the secret (PR #30, commit `c6e4ff2`)

- Challenge: `message` had survived two whitelists because it is a name every error has. But an error that carries a statement builds its message out of it, so the message is only safe when it comes from the cause — and even then some driver messages quote what the caller sent (`invalid input syntax for type uuid: "..."`).
- Verification: found by a test written to prove the _previous_ fix, not by a review — a query error with no `cause` still had the query as its message. The test failed, and it was right.
- Resolution (before/after): before, `message: rootCause(err).message`. After, the message is replaced outright with `database query failed` when the error carries `query` or `params`, otherwise cut at the first quoted value and bounded; and stack frames are matched on their shape (`/^\s+at .*:\d+:\d+\)?$/`) so a bound value containing a newline and `at ` cannot pose as a frame.
- Lesson: the first two whitelists were written against a described error shape, and each survived review until someone read the installed library. A field name is not a guarantee about the field's contents; only the code that produces it is.

## Overall reflection

### 2026-09-12 — after the HTTP skeleton (issue #6)

- Estimated ratio: roughly 85 % of the committed text (code, tests, docs) is AI-generated, 15 % human-crafted. The proportion inverts on decisions: the architecture choice between the two competing designs, the label-and-comment PR protocol, the assign/draft endpoint shape, the alarm-simulation requirement and the "log the stack, never return it" call were all made by the owner, and the AI's role was to draft and then be corrected.
- Blind spots noticed so far: (1) the AI reaches for a library option whose name matches the requirement (`redact` for "no credentials in logs") and stops there, without checking what the default path still emits; (2) untrusted input is treated as trusted whenever it arrives through infrastructure rather than through a request body — the `x-request-id` header is the clear case; (3) when a test fails, the first instinct is to change the code rather than to question the assertion; (4) documentation drifts silently — the README advertised `/health` after the route moved to `/api/health`, which no test could catch.

### 2026-09-12 — after the PR #30 review round (issue #6)

- Estimated ratio unchanged at roughly 85 % AI-generated to 15 % human-crafted text; the three corrections in this round were AI-found (the `architecture-critic` and the advisory review) but human-adjudicated, and the REVIEW.md §8.4 amendment was an owner call.
- Blind spots added to the list: (5) the AI reasons about the field it put in the log record and not about what the object it logs carries by itself — the error-object leak is the clean example, and the same shape would recur with a job payload or a config object; (6) a stated precaution is taken as still true without re-reading the file, so a silently failed edit survives every later step that reasons about it; (7) an error path is designed for the case where it runs first, not for the case where the response has already started.

### 2026-09-12 — after the second PR #30 review round (issue #6, commit `e46f14b`)

- Estimated ratio: unchanged at roughly 85 % AI-generated to 15 % human-crafted text overall, but this round moves where the human share sits. All four defects were found by AI reviewers; what was human was the instruction to check the installed dependency instead of the assumed shape, the decision to promote the log form into `REVIEW.md` 8.4 rather than leave it a habit, and the call to defer `SIGTERM` as a recorded gap.
- Blind spots added to the list: (8) a whitelist, a redaction or any other "only these fields" control is written against an imagined shape of the thing it filters, so it reads as a control while the real producer walks straight past it — the fix is to read the installed version, not the documentation; (9) fixtures are invented to match the implementation's assumptions, so the test certifies the bug; (10) redaction is tested only negatively, which cannot distinguish "the sensitive field is gone" from "the whole record is gone"; (11) a leak is treated as closed after the first fix, and the second-order paths (the message, the stack's first line, a framework's own stderr writer) are not traced — ADR-0008 now records the `res.headersSent` path, where Express prints the raw stack, as still open.

### 2026-09-12 — after the third PR #30 review round (issue #6, commit `c6e4ff2`)

- Estimated ratio: unchanged at roughly 85 % AI-generated to 15 % human-crafted text. One of this round's two defects was found by a test the AI wrote to prove the previous fix, which is the first time the suite caught a leak before a reviewer did; the human share was again the instruction (check what the delegated-to library does by default) and the call on `res.destroy()`. The third element — refusing to publish a `415` “the parser never returns” — was wrong, and the next round reversed it.
- Blind spot (11) from the previous round is now closed rather than restated: the `res.headersSent` path no longer reaches Express. Added: (12) a field that appears on a whitelist stops being questioned — `message` passed two reviews on the strength of its name while being composed out of the statement; (13) a probe is trusted for a claim it never tested — a three-line check that set `content-encoding` was cited as evidence that an unsupported _charset_ returns `400`, and the wrong conclusion was written into an ADR and a commit message before anyone re-read what the probe actually sent; (14) a control's coverage is assumed to extend to the framework's own default path, which runs after ours and obeys different rules — here, a different `NODE_ENV`.

### 2026-09-12 — Fourth review round on the HTTP skeleton (PR #30, commit `ccef8a4`)

- Strategy: the previous round's fixes were handed back to `architecture-critic` with the claims stated explicitly, so it could check each against the installed packages rather than against the summary. That is what caught the reversal below; a review that had only read the diff would have agreed with it.
- Human refinement: the decision to record the two remaining findings as issues ([#41](https://github.com/mfozmen/promotion-management-api/issues/41), [#43](https://github.com/mfozmen/promotion-management-api/issues/43)) instead of widening a skeleton PR, on the grounds that both are unreachable until a route touches the database, and that inventing the error shape a third time is exactly what the previous two rounds had cost.

#### `415` was reachable, and the probe that said otherwise had tested the wrong header

- Challenge: the body-parser mapping was rewritten to key off `err.status`, and `415` was deliberately left out of it. The justification, written into ADR-0008 and a commit message, was that "the installed parser answers an unsupported charset and an unsupported content-encoding with `400`, which a probe in `tests/app.test.ts` confirms". The probe had set `content-encoding: br` and a `utf-16` charset. It never sent a charset outside the `utf-` family, which is the only case body-parser rejects with `415`.
- Verification: `architecture-critic` read `body-parser/lib/read.js` and ran `Content-Type: application/json; charset=iso-8859-9` against the installed express: `status=415 expose=true type=charset.unsupported`. Because the status was not in the map, the caller received `500 INTERNAL` and the operator got a level-50 "unhandled error" line — a legacy or Turkish-locale client paging the on-call for its own mistake.
- Resolution (before/after): before, a three-entry status map and a 500 for anything else. After, any error marked `expose === true` whose status is below 500 keeps that status, with a named code where one is worth having and `BAD_REQUEST` otherwise; a 5xx claiming to be exposed is still masked, so a server fault is never relabelled as the caller's. `tests/app.test.ts` now asserts the `iso-8859-9` case. ADR-0008 records the correction and names the bad probe explicitly rather than quietly dropping the sentence.
- The lesson is not "check the library" — that instruction was already in force and had produced the probe. It is that a probe is evidence only for what it actually sent, and that a result gets promoted to a general claim on the strength of the confidence around it. The probe was three lines and correct about `content-encoding`; the ADR sentence it justified covered a case it had never run.

#### The error handler needed a logger it did not own

- Challenge: `errorHandler` read `req.log`, which exists only because `httpLogger` is mounted ahead of it in `createApp`. A sub-app mounting the error handler alone — a worker's admin server, a test helper — would have thrown a `TypeError` inside the error handler, Express would have fallen through to its final handler, and the raw stack would have gone to stderr: the exact leak closed one commit earlier, reopened by a file that never touched this one.
- Verification: `architecture-critic`; a test now mounts `errorHandler` without `httpLogger` and asserts it still answers.
- Resolution: `const log = req.log ?? logger`. The line that matters is that a fix can be undone from a distance, by code that has no reason to know the fix exists — which is why the rule went into REVIEW.md §8.4 rather than only into the ADR.

### 2026-09-12 — Comment-density round on the HTTP skeleton (PR #30, commit `87b0a49`)

- Strategy: the owner's finding was that the merged code read as narration rather than as code with notes, so the branch was measured against the comment-density rule proposed as §8b in PR #46 (branch `docs/comment-density`) instead of being re-read by taste. The rule is countable — more than one comment line per four of code is a finding — which turned a style argument into an audit: 45 comment lines removed across five source files, no code changed, `src/shared/logger.ts` from 67 per cent comment to 24.
- Human refinement: the owner set the rule and the threshold; the AI applied it and, for each comment it wanted to keep, had to state what the code could not say by itself. That test is what kept the deletion from becoming its own overcorrection.

#### The AI had been documenting its own reasoning, one review round at a time

- Challenge: the comments were not written for a reader. They were written by the AI at the moment it was reasoning, and each review round in this PR added another paragraph justifying the fix it had just made — the whitelist, the stack filter, the message guard, the `headersSent` branch — until `src/shared/logger.ts` was two thirds prose. Measured against REVIEW.md §12.3 — the rule this branch actually carries — and against §8b.1 as PR #46 numbers it, most of it was restating the next line or retelling an ADR the file already pointed at, and none of it was load-bearing: deleting it changed nothing a future editor could get wrong.
- Verification: counted, not judged — comment lines against code lines per file, which is what turns the rule from arguable into checkable. §12.3 states the outweighs-its-code finding without a number; the one-in-four threshold is §8b.3 and arrives with PR #46. Every surviving comment then had to answer §12.3 out loud, and every deleted decision had to be found in an ADR before it was allowed to go.
- Resolution (before/after): before, a 12-line docblock on `serializeError` re-deriving why the `err` key is avoided. After, four lines that name the contract and point at ADR-0009. Four comments survived the pass, and all four are contracts learned from a defect in this PR rather than narration: that a driver error carries the failing statement in its own fields _and_ in its message; that pino-http wraps a custom `err` serializer, so the whitelist belongs under an `error` key; that `.strict()` reaches the top level only, so a caller owns a nested object's strictness; and that `errorHandler` falls back to the root logger, because a file with no reason to know about the logging fix had already undone it once. A defect is what tells a contract apart from a comment that sounds useful.
- Lesson: AI comment output is a by-product of AI reasoning, and it accumulates monotonically — nothing in the generate-review-fix loop ever removes a comment, because each round only adds the justification for its own change. Left alone it grows until the prose outweighs the code. The check has to be a periodic sweep with a number on it, not a per-diff instinct.

#### The pointers were checked, and two of them pointed at nothing

- Challenge: replacing prose with "(ADR-0008)" or "(ADR-0009)" is only the move-it-to-the-ADR clause of §12.3 (§8b.4 once PR #46 lands) if the ADR actually carries the reasoning. Two did not. ADR-0009 said the stack's **first line** is dropped, while the code skips as many lines as the message has — the distinction is the whole fix, because `DrizzleQueryError`'s message is two lines and the second is the bound row. And the `req.log ?? logger` fallback, the subject of a surviving comment, appeared in this appendix but in no ADR at all.
- Verification: each pointer comment was read against the ADR section it named, and each line deleted without a pointer was searched for in `ADR.md`.
- Resolution: ADR-0009 now states the count-the-lines rule and why matching the message would mean matching attacker-shaped input, and carries the mount-alone fallback as a decision with its test. Nothing was lost to the deletion, but two things would have been.
- Lesson: "moved to the ADR" is a claim about a second file, and it is as checkable — and as often wrong — as any other claim the AI makes about code it is not currently looking at.

#### The cut was measured but not reviewed (commit `f8fb918`)

- An adversarial re-read of the cut itself restored three comments and deleted two more to pay for them. Restored: `validate`'s "a part with no schema reaches the handler raw", the caller contract that had survived only in ADR-0008 and that no test pinned — `tests/validate.test.ts` pins it now; an `(ADR-0008)` pointer on `error-handler.ts`, the only one of the five files left pointing at no ADR, which guards the status map against the inline that produced the 415-charset-as-500 regression twice on this branch; and a ceiling marker on `safeMessage` naming issue [#41](https://github.com/mfozmen/promotion-management-api/issues/41). Deleted to pay for them: `rootCause`'s docblock, which narrated a function named after what it does, and a duplicated comment in the tests — so every file is still under one comment line per four of code without the appeal clause. The honest part is that the first cut was measured but not reviewed: it hit the ratio and still removed two contracts. A count tells you a file carries too much prose; it cannot tell you which lines were load-bearing, and a deleted comment leaves nothing behind to notice, so only an adversarial read of the diff found them. The removals in a comment sweep need reviewing the way a review reads an addition.

### 2026-09-12 — after the comment-density round (PR #30, commit `87b0a49`)

- Estimated ratio: unchanged at roughly 85 % AI-generated to 15 % human-crafted text, but this round is the first where the human contribution was a **removal rule** rather than a correction. Measured on the branch's source files, the AI's first-draft comment share was between a quarter and two thirds per file; after the rule it is under a quarter everywhere, and the deleted prose cost nothing.
- Blind spots added to the list: (15) the AI writes comments as a trace of its own reasoning rather than for a future reader, so the comment density of a file grows with the number of review rounds it has survived and never shrinks; (16) a pointer to another document is emitted with the same confidence as a statement about the code in front of it, and is not verified against the target — twice here the ADR did not hold what the comment had been carrying.
