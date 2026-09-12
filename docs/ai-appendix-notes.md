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

### 2026-09-12 — Local infrastructure and environment config (issue #4, branch `chore/compose-config`, commit `d81d2b9`, PR #34)

- Strategy: asked for the local stack and the configuration reader in one pass, with ADR-0003 and `REVIEW.md` as the context rather than a free brief — `docker-compose.yml` (PostgreSQL 16 and Redis 7, healthchecks, named volumes, a named network), `.env.example` with placeholders only, and `loadConfig` in `src/shared/config.ts` reading and validating the environment once into a frozen typed `Config`. Ingestion knobs (`INGESTION_CHUNK_BYTES`, `BATCH_SIZE`, `BUDGET_MS`, `LEASE_MS`, `MAX_FAILURES`, `MAX_WAITING`) and the two Redis logical databases come straight from ADR-0003/0005, so the config surface was derived from the recorded design instead of invented.
- Human refinement: validation stayed hand-written rather than pulling in zod, because zod is scheduled to arrive with the request-validation story and a new dependency for twenty lines of parsing is a `REVIEW.md` 12.5 finding; the cross-field rules the design implies were made explicit (read-model and queue databases must differ, `INGESTION_LEASE_MS` must be at least `INGESTION_BUDGET_MS`), and `DATABASE_URL` and `REDIS_URL` are parsed as URLs so a connection-string typo fails at startup rather than at the first connect and every error names the offending variable.
- Verification: `docker compose up -d --wait` reaches healthy for both services, `btree_gist` (needed by the ADR-0004 exclusion constraints) is present in the `postgres:16-alpine` image, Redis databases 0 and 1 were confirmed separate, and `docker compose down -v` cleans up. `tests/unit/config.test.ts` covers 41 cases (missing, blank, malformed URL, non-numeric, decimal, zero, negative, above-maximum, the batch-size ceiling, defaults, overrides, derived URLs, shared-database rejection, lease shorter than budget) at 100 % on all four coverage metrics. The `e2e-tester` re-run then caught a REVIEW.md 10.3 leak: the "expected a URL" error echoed the offending value, which for `DATABASE_URL` includes a password. The two URL errors now name the variable without its value, asserted by an exact-message test (commit `629841d`). After `REVIEW.md` 12.3 ("comments earn their line") landed on main mid-branch, a final pass merged main and trimmed the comments that restated the identifier below them and the rule numbers quoted in code comments; no executable line changed (commit `124a236`). The `architecture-critic`, which `local-gates` requires once a PR touches `ADR.md`, returned SOUND and named two concrete traps that were closed rather than deferred (commit `09825c5`): `INGESTION_BATCH_SIZE` was bounded only by `MAX_SAFE_INTEGER`, so an operator raising it to speed up an import would exceed PostgreSQL's 65 535 bind parameters on every batch, and the store ports were published on every interface, offering a `promo`/`promo` PostgreSQL to any shared network. They are capped at 5000 and bound to `127.0.0.1` now. The critic also proposed deleting `redisUrl` and the two index fields from `Config`; they stay, because issue #4 asks for the indexes by name and `.env` is where an operator sets them, with the derived URLs as the form a consumer should use.
- Scope note: `loadConfig` is deliberately not wired into `src/app.ts` yet — no consumer exists until the first module that needs a database connection. The config keys were added as trace points to `.claude/agents/impact-analyzer.md` in the same change. No new architectural decision was taken; ADR-0003 already records PostgreSQL + Redis + BullMQ with two logical databases, and was amended only to name the compose file, the env keys and the config module. The compose file is the two stores only: the application containers, the migration step and the `monitoring`/`tools` profiles belong to issue #19, so the seams they need (healthchecks to wait on, a named network to join, named volumes, every knob in `.env`) were left in place.

### 2026-09-12 — Comment-density pass against REVIEW.md 8b (PR #34)

- Strategy: `REVIEW.md` gained section 8b (comment density, severity Warning) on branch `docs/comment-density`, PR #46, while this branch was open — so the citation here is to 8b as that branch numbers it, and moves with the section if #46 renumbers before it merges — so `src/shared/config.ts` was re-read against it. The file was already under the one-comment-line-per-four-code-lines target at 95 code / 22 comment lines (23 %), so it was checked against 8b.2, the always-a-finding list, rather than trimmed towards a number; it ends at 95 / 16 (17 %). `tests/unit/config.test.ts` measured at 1 % and was left alone.
- Human refinement: cut the nine-line module docblock, whose opening line restated the module's own name; its two remaining reasons — `loadConfig` taking the environment as a parameter so tests inject a fixture instead of mutating `process.env`, and validation being hand-written rather than pulling in zod, with the note that the request-body story may fold this schema into it — survive as a three-line comment. Shortened three interface docblocks whose first clause restated the field name while their second clause carried real information: `chunkBytes` (kept "a target, not exact: the boundary moves forward to the next 0x0A"), `redisUrl` (kept that the two derived `*Url` fields come from it) and `redisQueueDb` (kept the invariant that it is never equal to `redisReadModelDb`).
- Kept, because each states something the type cannot: the units and semantics on `batchSize` (rows per upsert transaction), `budgetMs` (before the chunk checkpoints and hands off), `leaseMs` (must outlive the budget so a healthy run keeps its claim) and `maxWaiting` (the 429 backpressure threshold); the fail-at-startup reason on `parseUrl`; the note that a bad URL's value is deliberately not echoed because a connection string carries a password and the message reaches a startup log; the "shape check only, the drivers receive the raw strings" note; and the PostgreSQL 65 535 bind-parameter reason for the batch-size cap.
- Verification: no behaviour change, no renames, no `package.json` change — the diff is comment lines only. `lint` and `typecheck` clean; `test:cov` 42 tests passing at 100 % on statements, branches, functions and lines — 42 across the suite, being the 41 cases in `tests/unit/config.test.ts` (18 plain `it` plus 23 from five `it.each` tables) and the one health test. Landed in `10b9f5e`.

### 2026-09-12 — Connection strings validated and published ports cross-checked (PR #34, commit `3dca8a7`)

- Strategy: the brief was two `REVIEW.md`-anchored gaps rather than a free hand. 8.1: `new URL` accepts `redis://` and `garbage:`, so `parseUrl` now asserts the scheme and a non-empty host, and still never echoes the value, because a connection string carries a password and the message reaches a startup log. Second: nothing tied the ports `docker-compose.yml` publishes to the URLs the drivers dial, so moving one and forgetting the other connects the application to whatever else already listens on the old port. `assertPortMatchesUrl` cross-checks `POSTGRES_PORT` against `DATABASE_URL` and `REDIS_PORT` against `REDIS_URL`.
- Human refinement: cross-check rather than derive, because the URL is authoritative in every deployment that has no compose file at all, and the check applies only to loopback hosts — a container dialling `postgres:5432` on the compose network is unaffected by what the host publishes. `.env.example` states the coupling under each `*_PORT` so the constraint is visible where the value is set, not only in the error.
- Verification: 60 tests, 100 % on statements, branches, functions and lines. The `architecture-critic` re-run returned REVISE, so `architecture-verified` was deliberately not applied; the remaining findings sit with the owner.

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

### 2026-09-12 — The loopback test was wrong in the first version of this very fix (PR #34, commit `3dca8a7`)

- Challenge: the port cross-check only applies to a loopback host, and the first version tested for that with an exact match against `localhost` and `127.0.0.1`. `postgres:` and `redis:` are non-special schemes, so WHATWG `URL` does not normalise their hosts the way it does for `http:`: it preserves the host's case and a trailing dot. `LOCALHOST`, `localhost.` and any of the rest of the 127/8 block are all loopback and all failed the test, so the check silently did nothing for them — the worst failure shape for a guard, since it reports nothing while the mismatch it exists to catch goes through.
- Verification: caught by the `architecture-critic` on the first version of the fix, then pinned by cases in `tests/unit/config.test.ts` rather than by argument.
- Resolution: `isLoopback` lowercases the hostname, strips a trailing dot and accepts the whole `127.0.0.0/8` block as well as `localhost` and `[::1]`.

### 2026-09-12 — A startup guard that would have crash-looped Kubernetes (PR #34, `ac9c8aa`)

- Challenge: the published-port cross-check added in `3dca8a7` treated any non-port content in `POSTGRES_PORT` or `REDIS_PORT` as a mismatch and aborted startup. Those are exactly the variable names Kubernetes injects for Services named `postgres` and `redis`, in the form `tcp://10.96.1.5:5432`, and the compose file in this PR names the services precisely that. With the common sidecar-proxy pattern making `DATABASE_URL` loopback, every pod in the namespace would have crash-looped at startup, with an error message blaming a compose file that deployment never had.
- Verification: caught by the `impact-analyzer` agent, which asked specifically whether the new validation could reject a configuration that previously worked and that a legitimate deployment would use, then built the injected Kubernetes environment and ran `loadConfig` against it. It re-ran the same construction after the fix and confirmed the configuration is accepted, and that a real numeric mismatch still throws, so the guard was narrowed rather than defeated.
- Resolution: the cross-check returns early unless the value matches `/^\d{1,5}$/`. Tests gained the Kubernetes Service form, a bare `host:port`, a non-numeric value, and an IPv6 loopback mismatch that also closed an untested `[::1]` branch; 64 passing at 100 % on all four metrics.

### 2026-09-12 — Deleting the guard beat fixing it twice (PR #34, `e1c34cf`)

- Challenge: `assertPortMatchesUrl` and `isLoopback`, added in `3dca8a7` and narrowed in `ac9c8aa`, are gone. The owner took the `architecture-critic`'s recommendation to delete rather than guard: `POSTGRES_PORT` and `REDIS_PORT` were never this application's variables to read, because Kubernetes injects `POSTGRES_PORT=tcp://10.96.1.5:5432` for any Service named `postgres`, and cross-checking a name someone else owns adds a failure mode without buying anything. Earlier entries in this file describe that mechanism in the present tense; it no longer exists.
- Verification: the same critic pass measured the PostgreSQL healthcheck that replaced `pg_isready`. It does catch a database name or role that no longer matches an initialised volume (`pg_isready -U promo -d nosuchdb` exits 0, the `psql` check exits 2), but it does not catch a changed password, because the image generates `pg_hba.conf` with `local all all trust` at volume initialisation and never regenerates it, so no in-container check can authenticate. The ADR sentence claimed all three; it now claims what was measured and names where a password mismatch actually surfaces.
- Resolution: the two variables, the two helpers and their tests are deleted; `docker-compose.yml` publishes 5432 and 6379 as literals; ADR-0003 records why the pair must not return, narrows the healthcheck claim, and states that `loadConfig` having no consumer is deliberate. 52 tests at 100 % on all four metrics.

## Overall reflection

- Estimated ratio: pending.
- Key takeaway: pending.
