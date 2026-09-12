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
- Resolution (before/after): before, the root logger had no `err` serializer and the handler logged the error object. After, `src/shared/logger.ts` defines `serializeError` emitting `{ type, message, stack, code }` and nothing else, wired into the pino-http `serializers` map, so the whitelist applies to every `err` logged anywhere in the process. REVIEW.md §8.4 was amended in the same PR — as its own preamble requires when a rule and the design disagree — to scope "no internal detail escapes" to the client-facing response and to forbid SQL text, bound parameters and secrets in logs while allowing a stack, ending with "logging an error object directly is a finding". Recorded in ADR-0009 and cross-referenced from ADR-0008.

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
