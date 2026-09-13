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
    key would have come straight back in the error body; 8.3c capped it at 64
    characters and truncated rather than omitting. Both rules were later
    deleted with the field they governed: the owner removed `details` from the
    response entirely, so a rejection names the part that failed and nothing
    else, and the mirror the rules bounded no longer exists to bound.
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

### 2026-09-12 — The port cross-check deleted, the healthcheck claim narrowed (PR #34, commits `e1c34cf`, `4c21ea0`)

- Strategy: the third `architecture-critic` pass was given the branch rather than the last diff, and its recommendation on the twice-patched port cross-check was to delete rather than guard again. `POSTGRES_PORT` and `REDIS_PORT` are gone everywhere, together with `isLoopback`, `assertPortMatchesUrl` and their tests: those are the names Kubernetes injects for Services called `postgres` and `redis`, so they were never this application's to read. `docker-compose.yml` publishes 5432 and 6379 as literals and ADR-0003 states why the pair must not return.
- Human refinement: claims were held to what had been measured. `4c21ea0` withdrew an overstatement of mine about the authenticated `psql` healthcheck — it catches a database name or role that no longer matches an initialised volume, but it cannot catch a changed password, so the ADR and the compose comment now say that and name where a password mismatch does surface. A `leaseMs === budgetMs` boundary test was added rather than the equality being tightened away: equality stays legal deliberately until a reclaim sweep exists to make a stricter margin mean anything.
- Verification: 52 tests, 100 % on statements, branches, functions and lines. The `architecture-critic` returned REVISE on its third pass, so `architecture-verified` is again deliberately not applied. One finding was left open with the owner at that point: `parseUrl` accepting a `DATABASE_URL` with no database name. The owner ruled it a trust-boundary check rather than a candidate for deferral, and commit `3926632` closed it.

### 2026-09-12 — The database-name check, and the fourth architecture pass (PR #34, commits `06b6df3`, `3926632`)

- Strategy: the fourth `architecture-critic` pass was handed the whole branch again and returned **SOUND**, after three REVISE verdicts on the same branch (`3dca8a7`, loopback host matching; `ac9c8aa`, a startup guard that would have crash-looped Kubernetes; `e1c34cf` with `4c21ea0`, deleting the port cross-check and narrowing the healthcheck claim). The single finding the third pass had left open with the owner — `parseUrl` accepting a `DATABASE_URL` with no database name — was closed in `3926632` rather than carried into a later PR, so `architecture-verified` applies to this branch for the first time.
- Human refinement: the new check was scoped to the one URL where the omission decides something, and the asymmetry was written down rather than left for the next reader to rediscover (ADR-0003). Two comments that described a future as if it were today were also withdrawn: `06b6df3` stopped the README claiming validation runs at startup when nothing calls `loadConfig`, and `3926632` rewrote the `.env.example` Redis block and the `docker-compose.yml` header, both of which said the application reads these variables.
- Verification: 55 tests, 100 % on statements, branches, functions and lines.
- Carried forward as stated trade-offs, not open defects: `loadConfig` has no consumer yet, deliberately — the first module that opens a connection wires it in and reconciles the duplicate `PORT` read in `src/server.ts`; the PostgreSQL healthcheck cannot catch a changed `POSTGRES_PASSWORD` against an already-initialised volume, because the image writes `trust` rules into `pg_hba.conf` at initialisation and never regenerates them, so the mismatch surfaces at the first consumer's connect and the fix is `docker compose down -v`; and `POSTGRES_PORT`/`REDIS_PORT` must not return, because Kubernetes owns those names for Services called `postgres` and `redis`. All three are stated in ADR-0003.

### 2026-09-12 — Merged main, and the stack contract the e2e agent measures (PR #34, commits `82ed2fa`, `f588058`)

- Strategy: the branch was five commits behind `origin/main`, so main was merged rather than the branch rebased, to keep the four `architecture-critic` verdicts already recorded against their commits. The only conflict was in this file: both sides had appended entries about different pull requests into the same two sections. Resolved by keeping every entry, main's first and this branch's after — this file is append-only, so a conflict here is never a choice between two versions.
- Human refinement: `.claude/agents/e2e-tester.md` brings the stack up with `docker compose` on a fixed host port and polls a health route. Fixing the port is deliberate: it is what stops two concurrent runs measuring the same machine. **Superseded on 2026-09-13 in both its port and what the compose file holds** — the port is 3100, because 3000 is the default of every other Node service on a developer's machine and was already taken here, and the compose file now holds an `api` service built from this repository, publishing `127.0.0.1:3100` and migrating before it listens, so the contract lives in the compose file rather than in a comment beside it.
- Doc check against main's CI changes of the same day: the required checks are now `ci` and `claude-review` only, `local-gates` still runs but no longer blocks a merge, the pull-request title check is gone, and SonarCloud scans only when the diff touches something it reads (`e0beddd`, PR #56). Nothing this branch adds to ADR.md or README.md describes CI, so nothing there is falsified. One branch-added sentence in this file is now dated — "the `architecture-critic`, which `local-gates` requires once a PR touches `ADR.md`" — and is left standing rather than edited, because this file is not rewritten; the correction is this line. The agent labels are still computed and asserted by `local-gates`, they simply no longer hold a merge.
- Verification: `git diff origin/main...HEAD` re-read end to end against ADR.md and README.md; `docker compose config` still parses (comment-only change); no source file touched in this round. README.md gained the port-and-health contract and a note that the design spec puts every route under `/api`, while the shipped scaffold route is still `/health` — the table states what ships, not what is planned.

### 2026-09-13 — Owner review: the tools profile in, zod in, the case file out (issue #4, PR #34, commits `03ef8f2`, `e3e062f`, `dab2705`, `6c8794d`, `0da5394`)

- Strategy: the owner reviewed the branch and took three decisions inline on the pull request, all landing here. Criterion 4 of #4 (`docker compose --profile tools up` starts the database browsers, plain `up` does not) was pulled back from #19: Adminer on 127.0.0.1:8081 and redis-commander on 127.0.0.1:8082, both behind `profiles: [tools]`, both waiting on the store healthchecks, from the owner's snippet on the compose header thread. `src/shared/config.ts` shrank from 149 lines of hand-written parsing to a zod schema of about forty: coerce and defaults for the typing, and exactly the three checks that would otherwise fail late and quietly — a `DATABASE_URL` with no database name, the read model and the queue on the same Redis logical database, a lease shorter than the budget. Criterion 3 (CI service containers) is stated in the PR body as arriving with #50.
- Human refinement: the branch's earlier reasoning — zod deferred because a new dependency for twenty lines of parsing is a `REVIEW.md` 12.5 finding — had gone stale without anyone noticing: zod has been in `package.json` since #27 and #30 uses it, so the hand-written validator was the duplicate, not the dependency. The Redis URL derivation (`redisUrlForDb`, `redisReadModelUrl`, `redisQueueUrl`) left the config for the module that opens a connection. Two deviations from the owner's snippet: `z.url()` rather than the deprecated `z.string().url()` on zod 4.6, and a `path` on each object-level refine so the thrown error names the key, which is what the test asserts. `docs/e2e-cases/4.md` was deleted with no replacement: main now holds one case file per user journey, and a compose file is a task, which owes no case.
- Post-review fixes in the same round: `impact-analyzer` found that zod 4 runs a `.refine` even after the `z.url()` format check fails, so `new URL(u)` inside the database-name refine threw a raw `TypeError` whose `input` property carries the connection string — pino's `err` serializer would have written a malformed `DATABASE_URL`, password and all, into a startup log. That is `REVIEW.md` 10.3, blocking, and it was a regression: the 55-case suite had a test asserting the old error never echoed the value, and that test went with the suite. `URL.parse` (Node 22, returns `null`) makes the refine parse-safe, and a test now asserts the thrown error names `DATABASE_URL` and does not contain a marker password. A boundary case for `INGESTION_LEASE_MS === INGESTION_BUDGET_MS` was restored for the same reason. The agent's third finding, pinning `rediscommander/redis-commander:latest`, was answered rather than adopted: the publisher ships no version tags at all, so the tag stays with a comment saying why.
- Comment and structure rules: `main` made `REVIEW.md` 8b (comments) and 8c (one declaration per file) critical and blocking mid-round, so the new module was re-read against them after merging. The seven-line header explaining why only three checks exist was cut to a two-line pointer at ADR-0003, which is where that decision now lives (8b.3 — prose explaining a decision belongs in the ADR, and the comment reproduced it); the module is 4 comment lines of 37. `docs-scribe` then caught the AI claiming 8c.2 permitted the module's two exports (`Config` beside `loadConfig`) when the rule says a second exported declaration is a finding — an appeal to a rule that did not say what it was quoted as saying. Rather than ask for a carve-out, the exported type was deleted (commit `0da5394`): nothing imported it, `loadConfig`'s return type is inferred, and a consumer that needs a name can write `ReturnType<typeof loadConfig>`. One export, no ruling needed.
- Second comment pass, on the owner's ruling: `docker-compose.yml` was 45 comment lines in 121, and the AI had defended most of them as context. The owner's reading of 8b is narrower than the AI's — a compose file states what runs, and every "why" belongs in ADR.md beside the decision — so the file now carries no comments at all, and `.env.example` at most one short line per variable. The four reasons the comments were genuinely holding and the ADR did not yet carry (append-only on with no `maxmemory`, `log_lock_waits`/`deadlock_timeout` against the defaults that would report a deadlock-free run, loopback binding on every published port including the browsers, and the unpinnable redis-commander image) moved into ADR-0003 rather than being deleted, which is what 8b.3 asks for. The stack was brought up again from the stripped file to prove the trim changed nothing: all four services healthy, `btree_gist` available, both browsers answering 200.
- Verification: `docker compose --profile tools up -d --wait` reached healthy for all four services and both browsers answered HTTP 200 on their loopback ports; `docker compose up -d --wait` afterwards started only `postgres` and `redis`. `tests/unit/config.test.ts` went from 296 lines and 55 cases to 9: a valid env parses with defaults, overrides coerce, `process.env` is the default source, a missing `DATABASE_URL` throws naming it, and the three quiet failures each throw naming their key; the malformed-URL and lease-equals-budget cases restored by the post-review fixes above take it to 9. `lint`, `typecheck` and `test:cov` clean at 100 % on statements, branches, functions and lines, 10 tests across the suite at `6c8794d`, unchanged at `0da5394` (a type-only deletion).

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

### 2026-09-12 — Validation that let an unusable value through (PR #34, `3926632`)

- Challenge: `parseUrl` checked the scheme and the host of `DATABASE_URL` and stopped there, so `postgres://localhost:5432` and the bare-slash form both loaded clean. node-postgres then falls back to `PGDATABASE`, then to the user name, then to the OS user, so the process connects to something and the mistake surfaces much later as missing tables. Validation at a trust boundary that lets an unusable value through is not validation.
- Verification: raised by the `architecture-critic` on its third pass and recorded rather than closed at the time; the fallback chain was read against node-postgres's documented defaults instead of assumed, and both failing shapes are pinned in `tests/unit/config.test.ts`.
- Resolution: `parseUrl` now rejects an empty path and a bare `/` with "the URL has no database name". `REDIS_URL` is deliberately exempt, because `redisUrlForDb` overwrites the path with the validated `REDIS_READ_MODEL_DB`/`REDIS_QUEUE_DB` index, so a path there decides nothing; a test pins that a pathless `REDIS_URL` still derives `/0` and `/1`. ADR-0003 records both halves of the asymmetry. 55 tests, 100 % on all four metrics.

### 2026-09-12 — A contract recorded in halves (PR #34, `1031af6`)

- Challenge: the fifth `architecture-critic` pass (verdict **SOUND**) found that the previous commit had written down one half of the contract `.claude/agents/e2e-tester.md` states. The agent's deadlock step also requires `log_lock_waits=on` and `deadlock_timeout=200ms` on the `postgres` service, which this branch owns — not on issue #19's `api` service. With the defaults (off, one second) the first branch to add a write endpoint would have read a log with no lock waits and reported "no deadlock detected" from a stack that could not have shown one: a green result proving nothing.
- Verification: the critic read the agent definition end to end rather than the half the previous commit had quoted, and `docker compose config` was re-run against the changed service.
- Resolution: the two knobs are set on the `postgres` service with the reason in a comment. The same pass also caught a commit hash quoted in `README.md` — CLAUDE.md mandates squash merge, so the hash would not survive it (REVIEW.md 8b.5); the parenthetical is gone and the sentence is complete without it. One finding was routed rather than fixed here: `e2e-tester.md` has no not-applicable path for a compose project that publishes no `api` service, so the gate it defines cannot pass on an infrastructure-only branch. That file is owned by main and belongs to the issue #19 branch.

### 2026-09-13 — A deferral argued from a fact that was no longer true (PR #34, `e3e062f`)

- Challenge: the owner asked what the 149-line hand-written validator was for, given that its stated reason for not using zod ("zod is not here yet, a dependency for twenty lines is a 12.5 finding") described a `package.json` two pull requests old. Two earlier entries in this file (the first `chore/compose-config` entry and the comment-density pass) and the module comment in `src/shared/config.ts` had repeated that reasoning without re-checking it.
- Verification: `grep zod package.json` and `git log -S zod -- package.json` on `origin/main`: the dependency arrived with #27 and is imported on #30. The premise of the deferral had been false since before the branch's third review round.
- Resolution: the validator and its 296-line test file are replaced by the owner's schema; every check that merely re-typed a value went, the three that catch a quiet late failure stayed. The lesson recorded for the appendix: a documented reason to defer must be re-verified on every merge from main, because the AI carries the sentence forward verbatim and the tree does not.

### 2026-09-13 — A control that reads as safe and is not

- Challenge: an `architecture-critic` round found a comment claiming that `as const` "stops anything rewriting a row at runtime". It does not: the annotation is erased at build time, so the three error lookup tables were ordinary mutable objects in the shipped JavaScript, and one assignment from any consumer would have changed the error body of every concurrent request in the process. The fix was to freeze them. The next round found the freeze was shallow: `Object.freeze` held the key-to-row binding and left each row writable, and a row's fields are exactly what the envelope spreads into a response. The test written alongside the first fix asserted the assignment the freeze does stop and never the one it does not.
- Verification: the agent proved it by probe rather than by argument, assigning to a frozen table's row and getting a database connection string back as the body of a 413. The corrected test asserts that assignment throws and that the message is unchanged afterwards, and it failed before the fix.
- Resolution: each row frozen individually, the constant holding the body of every 500 frozen, and a `ReadonlySet` whose `.add` still worked replaced by a frozen array — that last one sitting in the same file as the sentence claiming the type was the control. REVIEW.md 7.4b gained this as its third piece of evidence: assert the reachable breach, not the one the control obviously covers.
- Lesson: a type annotation is not a runtime control, and a comment that says it is will be believed by the next reader. When prose claims a guarantee, the test has to attack the guarantee, not the annotation.

### 2026-09-13 — Writing a rule does not inoculate you against it

- Challenge: the advisory review found that a test added with the 5xx logging fix passed its cause as the error class's third constructor argument, which is `details`, not `Error.cause`. The serialiser reads `err.cause`, so the injected driver error was inert: the test pinned the two new fields and never the claim its own comment made, and it would have passed identically with the cause deleted. That is REVIEW.md 7.4b, whose evidence the same branch had widened one commit earlier.
- Verification: the corrected test sets the real `cause` and asserts the serialised error carries `ECONNREFUSED` alongside the 503 the client read. The production fix was then removed on purpose to watch the test go red, and restored — the check the first round had skipped.
- Resolution: test rewritten. The same round corrected a first draft of this entry which claimed the branch had authored the rule it broke; it had not, and a `docs-scribe` run caught the overclaim against the commit history.
- Lesson: knowing a rule, even having just sharpened its wording, does not protect you from it; the habit that catches it is mechanical — break the production code and watch the test fail. And a self-critical note that flatters the narrative gets checked less often than a claim about a library, because it reads as humility rather than as a claim.

### 2026-09-13 — A merge that would have reverted a route, caught by the rename it came with

`main` moved `tests/health.test.ts` to `tests/unit/app.test.ts` while a branch had created a different file at that path, so git raised an add/add conflict rather than a silent overwrite. Main's copy asserted `GET /health` returns 200; the branch had moved the route to `/api/health` and kept a test asserting the old path now 404s. Taking either side wholesale would have been wrong: main's would have failed, and the branch's would have dropped the rename. The resolution folded the two health cases into the branch's app tests and deleted the extra file, because the layout rule is one test file per source file and no `src/health.ts` exists.

Lesson, narrow and worth keeping: a rename conflict is the one conflict shape that cannot be resolved by preferring a side, because each side describes a different tree, and the question is which tree the merged code is in.

### 2026-09-13 — An alias that resolved everywhere except where the tests ran

The `@src` alias arrived from another branch while one branch had split the suite into vitest workspace projects. A workspace project does not inherit the root config's `resolve` block, so every aliased import failed to load and eleven test files went red at once — each of them green on either branch alone. Caught by running the suite, not by reading either change. The alias is now declared once and spread into every project, and REVIEW.md 7.8 carries the failure as its evidence.

### 2026-09-13 — Three rounds of fixing a claim instead of the thing

- Challenge: the owner asked that `docker compose up -d --wait` alone leave the schema in place. An AI-written one-shot migration service and the paragraph explaining it were wrong three rounds running, and each round "fixed" it by correcting the prose one level down.
- Verification: executing the command. `--wait` gets a one-shot wrong in both directions — an exited container reads as a failed stack, and a still-running one reads as success — so the boot went green at 9.4 seconds with the migration still installing, and green again over a migration heading for an auth failure that left no tables behind it. The same shape appeared in the drift check: `drizzle-kit generate` exits 0 when it fails, so a CI step asserting its exit status passed over real schema drift.
- Lesson: a green CI step and a plausible paragraph both read as evidence and are neither. The cheap check is running the command and reading its exit code.

### 2026-09-13 — A harness that measured a database nobody could reproduce

- Challenge: the `e2e-tester` agent brought the stack up with `docker compose up -d --wait` and tore it down with a plain `docker compose down`, explicitly leaving the `db` and `redis` volumes in place. Every run therefore measured whatever earlier runs had written: a promotion left active by a previous run changes the price a shopper case asserts, a half-ingested SKU set hides the duplicate a fresh ingestion run would catch, and a Redis read model built by older code answers for a schema that no longer exists.
- Verification: human, by reading the agent definition against what an end-to-end number is supposed to mean — a result reproducible from migrations plus the run's own writes. No test caught it, because the harness itself was the defect and a green run on dirty state looks identical to a green run on clean state.
- Resolution: setup is now `docker compose down -v --remove-orphans` then `docker compose up -d --wait`, with migrations applied against the empty database before the first request; teardown drops the volumes too. README gained one line warning that a run destroys the local volumes.
- Lesson: agent definitions are treated as configuration and escape the review attention given to `src/`, yet they decide what "verified" means for the whole submission.

### 2026-09-13 — A prohibition that read as a control

- Challenge: the `e2e-tester` definition told the run to use bare `docker compose down` and `up`, and said "leave the `db` and `redis` volumes alone unless you created them". The compose file pins `name: promotion-management-api`, the same project the developer's own stack runs under, so the teardown would have dropped their `postgres-data` and `redis-data` volumes. The sentence read as a safeguard and had no mechanism behind it.
- Verification: reading `docker-compose.yml` rather than the agent's prose — the fixed project name, and the fixed published host ports, which also rule out two stacks coexisting. On Windows `netstat` attributes every published container port to `com.docker.backend`, so ownership has to come from the compose project label instead.
- Resolution: `-p pma-e2e` on every compose command — a flag rather than an environment variable, because each command runs in its own shell and the variable is gone by the next one; an ownership check before the first destructive command; `down -v` then `up -d --wait --wait-timeout 300` from empty volumes; teardown on the run's own project.
- Lesson: an instruction phrased as a prohibition was accepted as a control for weeks. Only isolation by project name makes it enforceable, and the hazard was invisible until someone asked what the command would actually delete.

### 2026-09-13 — A documentation claim that aged into a falsehood

- Challenge: an ADR trade-off written while a branch was still open promised that the branch "asserts in a unit test that its compiler accepts exactly that shape". After a rebase the compiler had landed and the assertion lived in an integration test against the real seeded rows, so the sentence named both the wrong tense and the wrong kind of test. The same section cited three commit hashes the rebase had orphaned, which resolve to nothing in a fresh clone.
- Verification: `git merge-base --is-ancestor` over every hash cited in ADR.md and README.md, and the test kind read off the file rather than off memory of the pull request description.
- Lesson: forward-referencing prose is correct when written and false the moment the referenced branch merges or is rebased. A cross-branch claim should be written as the check that proves it, not as a promise about other work — and a commit hash in a document is a claim to be re-verified after every rebase. REVIEW.md 8b.5 now forbids them outright.

### 2026-09-13 — The refactors renamed the code and left the prose describing a shape it no longer had

- Challenge: a day of class-extraction refactors left ADR.md describing structure that had moved underneath it — a "private lookup method" that is an inline `Object.hasOwn` check, a deleted file cited under a name it never carried, a "five files" cost count the same refactor had cut to three, and "twelve tables" where the tree holds six tables, five enums and one view. Two further sentences said work was pending that had already merged.
- Verification: every class, method and path the record names was read against the worktree and against `git ls-tree origin/main`, rather than against the record's own prose.
- Lesson: an AI-assisted rename is reliable in code and unreliable in the prose about it, and every stale claim described structure rather than behaviour — so tests, typecheck and coverage stayed green through all of it. Nothing mechanical was going to catch them, which is why a documented-paths test was written to catch at least the paths.

### 2026-09-13 — Documented paths, extracted mechanically

A container healthcheck and an agent's readiness step both polled `/health` after the route moved under `/api`. Neither was caught by reading: the compose file was proved wrong by booting the stack in its own project with the ports overridden, and the path was then extracted mechanically. The same technique — pull every backticked repository path out of the documents and stat it — found four dead paths in an ADR that three review rounds had read past, and it is now a test on main rather than a habit.

Its limit is known, and was hit three times the same day: it checks paths, not identifiers or claims. A renamed export still named in prose, and an `ADR-00NN` citation pointing at the wrong record, stay green.

### 2026-09-13 — A crashed test worker reads exactly like a failing test

After resetting a git worktree, `npm run test:cov` died with "Worker exited unexpectedly" and then `MODULE_NOT_FOUND` inside rollup's native binding. That is not a failing test: `node_modules` was wedged. `npm ci` then failed twice more, first on husky's prepare step (a worktree's `.git` is a file, so there is no hooks directory to install into) and then on `ENOTEMPTY` under `drizzle-orm`. Removing `node_modules` and reinstalling with scripts disabled cleared it.

Recorded because it is the mirror of the failure class this project kept hitting all week: a green gate that cannot fire proves nothing, and a red one that comes from the toolchain rather than from the code proves nothing either. Both are read as a verdict on the change, and neither is one.

### 2026-09-13 — A threshold nobody checked was reachable, held by the thing that judges it

Three files carried "p99 under 100 ms at 100 connections" for the storefront routes. Two were claims in documents; the third was `.claude/agents/e2e-tester.md`, the pass conditions of the agent that judges a run. The project's own ADR records `GET /api/health` — a route that serialises a constant and touches nothing — at 130-192 ms p99 at that same concurrency on this machine, so the bar sat below what an empty route clears. Any run would have been marked fail by an instruction nobody could satisfy, and the report would have read as a system problem rather than as a bad threshold.

This is the week's recurring defect with its polarity flipped: not a gate that cannot fire, a gate that can only fire. The root is identical — nobody had asked whether the threshold was reachable, because a number in a document reads as a decision someone made. The fix derives the bar from the measured baseline, states in each copy which measurement it derives from, and tells the next machine to re-derive rather than inherit.

### 2026-09-13 — A promotion aimed at a product that does not exist answered 500

The foreign key raised `23503` and nothing caught it, so an admin's typo in a product id paged someone instead of being refused. The README's error table for that route did not list the case either.

Two independent places silent about the same path is not two misses: it is one miss counted twice, because the same person wrote both from the same mental model of the path. That is the argument for a reader who is not the author, which is what the agents are. Fixed with a foreign-key-violation mapper beside the existing unique-violation one, a 404, and two integration cases.

### 2026-09-13 — Three costumes of one defect: a test built from the code's own assumption

- A double that rejected where `ioredis` resolves: `pipeline.exec()` returns an array of per-command errors and does not reject, even for a dead connection, so a mocked rejection proved a branch the library never reaches while production answered 500 with no `Retry-After`.
- Fixtures modelling a product the writer cannot produce — a base price of 10 000 beside an effective price of 9 000 with no promotion — so the reader and the fixtures confirmed each other and neither had asked what writes the hash.
- An ordering case whose two orders came out in the same sequence, because the mutation moved the seed the assertion read.

Each was written carefully, each was wrong, and none was caught by reading it again. The rule that came out of them is an instruction rather than an observation: break the thing the test names and watch it fail. A mutation is the thing outside both code and test — it asks the test a question the code did not supply the answer to.

### 2026-09-13 — Eleven review rounds on one pull request, and what ended them

- Challenge: the queue pull request took eleven agent rounds. The code stopped changing at round four; every round after that re-read the whole branch and found another sentence in another document that a previous round's fix had left behind. Each finding was real, and none could have been found by the round that caused it, because each agent started from the full branch diff with no memory of what it had already judged.
- Contributing cause, and it was ours: the ADR grew five clauses specifying a read-model writer that does not exist. Every read of them produced a new and correct question that could only be answered in the story that builds the component.
- Resolution: after the first pass an agent reviews the range since the commit it last reported on, against its own earlier findings, and says which range it read and which findings it carried forward; a finding only another component's code can close is named once in the report and never written into the record; and a record states the obligation and the hazard and names the component that owns the shape. The first two rounds run this way took 32 and 83 seconds against two to five minutes before, and both reported reviewing the delta only.
- Lesson: an adversarial reviewer with no memory will always find something, and a record that describes unbuilt code will always give it something to find. Neither is a defect in the reviewer.

### 2026-09-13 — An absent required check and a passing one look identical

- Challenge: a pull request presented as ready. `gh pr checks` listed two rows, `claude-review` pass and `local-gates` pass; the pull request was MERGEABLE; all four agent labels were applied; four agents had returned PASS, PASS, SOUND and PASS. Every signal a human or an agent reads said finished.
- Verification: the required `ci` check was not red. It was not there. Querying `repos/.../commits/<sha>/check-runs` returned `local-gates` and `claude-review` and nothing else, on the current head and on the previous one. The only CI run that existed for the branch was a push-event run with zero jobs and conclusion `failure`, which GitHub does not attach to a pull request and which therefore appears nowhere a reviewer looks.
- Resolution: the workflow could not start. `.github/workflows/ci.yml` carried two identical `redis:` blocks under `services:`, so `yaml.parse` throws `Map keys must be unique at line 39`, so GitHub cannot evaluate `on.pull_request`. Parsing the file on every live branch established the damage was one pull request and nothing merged. The correction that outlives the eight deleted lines is that the local gate must fail on an absent required check, not only on a missing label.
- Lesson: a gate reasons about what it can see, and absence is invisible to it. A missing check produces no row, no colour and no diagnostic, so a list of green rows is not evidence that the required set ran — only that the checks which ran, passed. "What would make this fail, and has anyone seen it do that" does not reach a check that never existed. The question that does is "what was supposed to run here, and did it".

### 2026-09-13 — A rule fired on its own file, on its own author's branch

- Challenge: REVIEW.md 13.8 says a merged configuration file is checked by parsing it, not by reading it — load the merged file and compare the parsed result against what you meant it to say. Its recorded evidence is two `services:` blocks in `ci.yml` after a merge. The author of that rule then reconciled a branch after main moved, verified that REVIEW.md itself had taken both sides of the merge, ran the full suite, ran the conflict check, and did not parse the workflow file the rule is named after — which by then held two `redis:` blocks from an earlier merge on the same branch.
- Verification: `yaml.parse` on `.github/workflows/ci.yml`, which is the command the rule already prescribes. It throws on line 39 and takes ninety seconds to run once the question is asked. It was never asked, through four agent rounds and the reconcile, because the file was not in any diff.
- Lesson: not "apply the rule harder". A rule about a class of mistake is hardest to apply from inside that class — the merge was being checked for the failures merges are known to cause, in the files the merge touched, and the rule's own subject sat outside the diff the whole time. Three instances in one pull request of treating _what this diff touches_ as the edge of what this change can break: this one, a compose healthcheck polling a route the branch had moved, and an ADR consequence reading "the only consumer is the README" after the healthcheck had become the second consumer. Recorded plainly: six times in one day something looked green because a gate could not fire, and this is the only one where the rule existed, named the file, and was walked past by the person who wrote it.

### 2026-09-13 — Line endings decided whether a comparison was a comparison

- Challenge: a drift guard for the DDL export compares generated text against committed text with `readFile`. On a fresh Windows checkout the migrations come back CRLF while the export's header is LF, so the guard fails for a reason that has nothing to do with drift — and would have passed or failed by platform rather than by content.
- Verification: `git ls-files --eol` over the tree. 131 tracked files, zero CRLF in the index, 118 of them `i/lf w/crlf`. Git had been normalising on commit the whole time, which is what every "LF will be replaced by CRLF" warning was saying; they were read as noise for a day. So a repo-wide `* text=auto eol=lf` changes no blob at all — only what a Windows checkout puts on disk.
- Resolution: pinned repo-wide on `main` rather than inside the branch that found it: one file nobody else edits, so it costs no reconcile, and a zero-blob change affecting 118 checkouts earns its own commit message. The branch that found it pinned only `*.sql` and deliberately left the wide version alone rather than widening as a side effect.
- Lesson worth keeping beyond the fix, because it says which future check is safe: anything that asks **git** whether two things differ is immune, since git normalises both sides — the schema-drift CI step ends in `git diff --exit-code` and never saw this. Anything that asks **Node** is a coin flip by platform. The repository had exactly one such comparison and it was a day old.

### 2026-09-13 — Line endings, invisible rather than platform-split

- Challenge: a generated CSV fixture and the SQL files carried CRLF on a Windows checkout, and a stray `\r` reached the parsed values.
- Verification: not a red test. The CSV test was green on the author's machine, whose git has `core.autocrlf=true`, because the stray `\r` landed on `stock_quantity` — a field the assertion does not compare. It was invisible everywhere, on every platform, rather than red for some contributors and green for others. That is the sharper point: a passing test proves the assertion, not the file, and the defect was found by reading the fixture rather than by running anything.
- Resolution: `.gitattributes` pinned `*.sql` and `*.csv` to `eol=lf`, later superseded repo-wide by `* text=auto eol=lf` (#95), at which point the branch's narrower pins were deleted as redundant; and the DDL builder normalises `\r\n` before comparing, so the drift check is not platform-dependent.

### 2026-09-13 — Provenance half-cleared

- Challenge: a demo seed's upsert cleared `ingest_job_id` and `ingest_source_offset` when it overwrote an ingested row's price, and left `pricing_rules_version` set. The row would then claim a rule set had produced a price the seed had just replaced, and a "reprice everything below the current version" sweep would skip it as current.
- Verification: reasoning over the column set — every column that explains a price must be cleared with the price — confirmed by an integration test asserting all three are null after a re-seed over an ingested row.
- Blind spot: the model treated "provenance" as the two columns carrying the constraint's name rather than the three the ADR groups under that heading. The constraint's scope was mistaken for the concept's.

### 2026-09-13 — A documented failure mode that did not exist

- Challenge: the README and a pull request body both stated that of two concurrent demo seeds, the loser aborts on `23P01`. It is a plausible story — there is an exclusion constraint on active category promotions and both runs insert one — and nothing in the code contradicted it. Written by the model, reviewed by a human, and wrong.
- Verification: REVIEW.md 2.5 requires a concurrency claim to have a test that runs the operations in parallel and asserts the invariant. **Writing that test is what falsified the claim**; neither run ever failed. The mechanism is that both seeds contend on a thousand identical `sku` conflicts, and `ON CONFLICT DO UPDATE` takes the row lock before it evaluates its guard, so the second seed is still inside the product statement when the first commits. It then deletes the first's promotion by name and inserts its own. An adversarial agent measured this independently against a live server rather than accepting the explanation: the blocked session was released at the other's `COMMIT`, and an `ON CONFLICT DO NOTHING` control returned unblocked in 1.4 ms, which is what proves the lock is doing the work. The `23P01` abort is real, but only for a promotion the seed does not own.
- Before, verbatim: "Run one seed at a time: a promotion someone else created over `Electronics` is not deleted by name, and neither is the one a second seed running concurrently just wrote, so the loser aborts on `23P01` and rolls the whole file back rather than leaving half a catalogue."
- After: "Two seeds at once are safe. They serialise on the product rows — `ON CONFLICT DO UPDATE` takes the row lock before it evaluates its guard — and whichever commits second deletes the first's sale by name before writing its own, so you still get one catalogue and one sale. What the seed will not do is replace a promotion it does not own."
- Resolution: two integration tests racing both upsert paths, the mechanism named in a comment on the `ON CONFLICT` clause, the README corrected, and REVIEW.md 2.5 given the evidence plus the generalisation that the rule catches a wrong description as often as a wrong mechanism.

### 2026-09-13 — The correction that needed correcting, twice

- Challenge: the record of the entry above was itself wrong twice. First it defined the corrected README sentence against the claim it replaced ("safe rather than forbidden"), which describes the diff to a reader who never saw the old text. Then a rule's evidence said the test "ran them in parallel ten times", describing a loop the committed test does not contain; it was reworded, and the commit that reworded it changed the test in the same breath, leaving the new wording stale on arrival.
- Verification: reading each record against the tree at the head under review, not against the change that produced it.
- Lesson: a record states the current state of the tree. A sentence that only makes sense to someone holding the previous version is a diff, not documentation (REVIEW.md 8b.5).

### 2026-09-13 — A review range a rebase had already invalidated, and a guard that reported itself

- Challenge: a review agent was handed an incremental range whose start commit a rebase had made unreachable. `git log A..B` does not fail on an unreachable `A`; it reports all of `B`, so the agent would re-read the whole branch while reporting a cheap delta pass.
- Verification: the ancestor check the agent definitions gained that afternoon exists for exactly this, and this was the first time it met a real rebase. Two of three agents handled it well — one re-read the whole branch and said so, one fell back to `git diff A B`, a tree-to-tree comparison that is a complete content delta and needs no ancestry. **The third reported the ancestor check as passing when it demonstrably could not have**, and that was found only because the coordinator verified the hashes afterwards.
- Resolution: the fallback written into the definitions rather than left to each agent to invent.
- Lesson, and it is the day's own lesson turned on the day's own fix: a guard whose evidence is the guarded party's report is the failure mode this project spent the day naming. It went unnoticed for several rounds because the agent's finding was correct — which is exactly when nobody checks the provenance. A second, at the process level: a rebase invalidates every agent's saved review point simultaneously and nothing announces it, so each rediscovers it separately on its own next run.

### 2026-09-13 — Deletion sweeps are reliable on names and blind on implications

- Challenge: removing the `details` array from the error envelope was a one-line change in the handler and a four-document change in the record. The sweep that removed the field from the code and from the two obvious documents left the envelope shape intact in the design spec, a deleted file still listed in CONTRIBUTING's source layout, and — the costlier gap — no sentence anywhere saying what a rejection now tells the caller, so the README read as if a field path were still returned.
- Verification: a grep for the deleted identifiers across the documents, plus the documented-names test that checks backticked paths, `Foo.bar` members and `ADR-00NN` citations. The identifier grep caught the two stale shapes; **the test caught none of them, because an absent sentence has no name to search for**.
- Lesson: the rule that catches the second class is "name an absence" — when a field disappears, the record has to say what the reader no longer gets, which no mechanical search can propose.

## Overall reflection

- Estimated ratio: for the scripting and documentation work measured so far, the code is roughly 80 % AI-generated and lightly edited; the documentation started AI-generated and is closer to half human, because nearly every correction recorded above came from a human or an agent reading a claim against the tree.
- The blind spot that repeats: the model's prose describes the mechanism it intended, and its own tests do not check its prose. Three of the five defects in the demo-seed work were in description rather than in behaviour, and the rule that caught the largest of them works by forcing a test to exist for a sentence.
- A rule earns its place when running it costs less than the habit of not running it. REVIEW.md 13.8 says to parse a merged configuration file rather than read it; on one pull request that was skipped and the required CI check silently never ran — invisible, because an absent check produces no row. On the next merge, parsing all four configuration files took thirty seconds. The rule did not become more important between those two merges; it became cheaper than the alternative, because someone had seen what the alternative costs.
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

### 2026-09-13 — Running estimate after the owner's review of the compose branch (PR #34, `03ef8f2`, `e3e062f`, `dab2705`)

- Share, this branch: the compose file, the schema and the docs are AI-typed;
  all three decisions of the round are the owner's, and two of them reversed
  AI-written text that five architecture passes had let stand. The
  hand-written validator and its 296-line test file, roughly half the code
  the branch had produced, were deleted rather than refined.
- Blind spot noticed: a documented reason to defer outlives its premise. The
  "zod is not here yet" sentence was carried through three merges from main
  after `package.json` had gained zod (#27), and every review pass read the
  sentence instead of the tree. A deferral must name the fact it rests on, so
  the next merge can falsify it.
