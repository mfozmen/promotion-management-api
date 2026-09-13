# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one applied promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- zod (request validation at the boundary)
- pino + pino-http (structured JSON logging)
- PostgreSQL 16 write store, Drizzle ORM + drizzle-kit SQL migrations
- BullMQ on Redis 7 (event bus; see [ADR-0003](./ADR.md))
- zod (payload validation at the queue boundary)
- json-rules-engine (the ingestion pricing rules, read from the database)
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16, Redis 7 and the `api` image built from this repository's `Dockerfile` all run locally from `docker-compose.yml`)

## Getting started

```bash
npm ci
cp .env.example .env       # placeholders only; .env is gitignored
docker compose up -d --wait --wait-timeout 300   # PostgreSQL, Redis and the api, all healthy
```

That one command is the whole boot. `api` migrates before it listens, so `--wait` returns only once the schema is current and the application is answering on http://127.0.0.1:3100 — there are no tables, constraints, the `active_promotions` view or seeded `ingestion` pricing rules to install by hand, and no `DATABASE_URL` to get right: the service composes it from the same `POSTGRES_*` variables `postgres` reads. Every `up` is safe, because Drizzle's migrations table applies only what it has not already recorded.

It is one verb rather than two because a one-shot migration service cannot be waited on: `--wait` means "running, or healthy where a healthcheck exists", and a one-shot is neither for long, so it reports green over a migration still installing and red over one that finished. A long-lived service with a healthcheck has no such gap — the check cannot answer in front of a missing schema. ADR-0003 holds the measurements.

For a database that is not the compose one, `npm run db:migrate` applies the same migrations from the host against whatever `DATABASE_URL` names (`drizzle.config.ts` reads it from the environment, not from `.env`). `npm run dev` needs no such step: it runs the same `src/server.ts` the image does, so it migrates its `DATABASE_URL` before it listens. There is no ingestion command yet; the upload endpoint and chunk worker arrive with issue #16.

Tests and checks. The queue and shutdown integration tests obliterate the queues they use, so they run against their own Redis rather than the compose one; override the port with `QUEUE_TEST_REDIS_URL`:

```bash
docker run -d --rm -p 6399:6379 redis:7-alpine
npm test
npm run test:cov # needs a PostgreSQL, see below
npm run lint
```

`npm run dev` starts the API on `PORT` (default `3100`); `GET http://localhost:3100/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file.

The suite is split into layers, so the one that needs nothing can run anywhere:

| Layer                              | Command                    | Needs                     | Runs                        |
| ---------------------------------- | -------------------------- | ------------------------- | --------------------------- |
| unit (`tests/unit/`)               | `npm test`                 | nothing                   | pre-commit hook, everywhere |
| integration (`tests/integration/`) | `npm run test:integration` | real PostgreSQL and Redis | CI, before every push       |
| both, with coverage                | `npm run test:cov`         | real PostgreSQL and Redis | CI (the 100 % gate)         |

The integration tests run against a real PostgreSQL, never a mock. Point them at one with
`TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:55432/promotion`). That
default is not the compose server: `docker-compose.yml` publishes 5432 with the `.env`
credentials, so either reuse it with
`TEST_DATABASE_URL=postgres://promo:promo@localhost:5432/promotion`, or keep the harness's
template and clone databases out of the compose volume with a throwaway server:

```bash
docker run -d --rm --name pma-db-test -p 55432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=promotion postgres:16-alpine
```

The integration project's `globalSetup` applies `src/shared/db/migrations/*.sql` to a template
database once; each test file then clones that template, so files stay isolated and can run in
parallel. The template is named after the checkout and clones carry a timestamp, so several
worktrees can share one server without dropping each other's databases. Run one integration
suite per worktree at a time, though: the template is rebuilt at the start of each run, so two
runs in the same checkout would pull it out from under each other. Regenerate the
migrations with `npm run db:generate` after changing a module's `db/schema/`, and apply
them to a running database with `DATABASE_URL=... npm run db:migrate` (drizzle-kit reads
`DATABASE_URL`, not `TEST_DATABASE_URL`, and falls back to
`postgres://postgres:postgres@localhost:5432/promotion` when it is unset, which is not the
compose server's role). CI's "No schema drift" step runs `npm run db:generate < /dev/null`,
checks the tool's own success line, then `git add -AN src/shared/db/migrations` and
`git diff --exit-code src/shared/db/migrations`, so a schema change committed without its
migration fails the build. It reads the success line rather than the exit code because
`drizzle-kit generate` exits 0 even when it fails and writes nothing; `git add -AN` is what
makes an untracked new migration visible to the diff (ADR-0003, commit `c14fa50`).

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data` and `redis-data` volumes as well. An `e2e-tester` run never touches this stack: it puts `-p pma-e2e` on every compose command so its own volumes are the only ones it drops, and it stops rather than starting if you are holding 3100, 5432 or 6379.

### Configuration

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `SHUTDOWN_TIMEOUT_MS` is the one variable `src/shared/config.ts` does not parse: `src/server.ts` reads it directly (ADR-0003). `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — and `src/server.ts` calls it before it migrates or listens, so a bad value stops the boot rather than the first request. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432, 6379 and 3100 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL`, `REDIS_URL` or `PORT` to match. `PORT` defaults to 3100 in both `src/shared/config.ts` and `.env.example`, and the compose healthcheck and published port name 3100 literally, so changing it for the container means changing all three together. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores, the `api` service built from this repository's `Dockerfile`, and a browser for each store behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. `api` publishes http://127.0.0.1:3100 and migrates before it serves, so `docker compose up -d --wait` returns only once the schema is current and the application is answering — there is no migration command to run and no `migrate` service any more. The port is 3100 rather than 3000 because 3000 is what every other Node service on a developer's machine takes. Issue #19 adds the remaining containers (event-handler, ingestion-worker, reconciler) and the `monitoring` profile on top of it.

### The queue

BullMQ uses the logical database `REDIS_QUEUE_DB` names, while `REDIS_READ_MODEL_DB`
holds the read model, so queue maintenance and read-model rebuilds cannot destroy
each other (ADR-0007). `src/server.ts` reads both from `src/shared/config.ts` and
passes the queue one to `EventBus.connect`, which is what makes the configuration
check that they differ mean something.

`npm run dev` opens the queue connections at startup against `REDIS_URL`
(default `redis://127.0.0.1:6379`), but it starts and serves without a Redis
there: connection errors are logged and every publish fails at its 2 s bound
rather than hanging. Connecting has its own 10 s budget. `SIGTERM` closes the
HTTP server first and the queues last, and waits at most `SHUTDOWN_TIMEOUT_MS`
(default 10 s, `0` exits immediately) for open connections before closing the
queues anyway (ADR-0003).

## Project structure

```
src/                 app.ts (the Express app and the /api router), server.ts (the process entry point)
src/modules/         one module per directory, each owning its tables under db/schema/ and using
                     domain/, db/ and http/ as it needs them
src/shared/db/       the client, the migrator and the SQL migrations
src/shared/http/     the HTTP boundary: the error type and its status table, the error handler,
                     the not-found handler, the request validator and the request logger
src/shared/          config.ts, logger.ts (the root logger), serialize-error.ts (the error
                     whitelist every log site uses), max-message.ts
tests/               unit, integration and e2e, each layer mirroring src/
docs/                design specs (docs/superpowers/specs), end-to-end cases (docs/e2e-cases)
```

Directories are named for a role and a file holds one exported declaration named after it (REVIEW.md 8c.2, 8c.7).

Inside a layer the tree mirrors `src/`, one test file per source file. Every test file now imports its subject through the `@src/*` alias, (`tsconfig.json` `paths` + `vitest.workspace.ts`, which declares the alias once and spreads it into both projects — a workspace project does not inherit the root `vitest.config.ts` `resolve` block, so an alias declared only there fails every aliased import at load time); production code under `src/` uses relative specifiers and never the alias, because `tsc` does not rewrite path aliases on emit — an ESLint rule enforces that boundary ([CONTRIBUTING.md](./CONTRIBUTING.md)).

## Database schema

The DDL is the migration set in [`src/shared/db/migrations/`](./src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the five enums, the six tables, the two GiST exclusion constraints that enforce one active promotion per product and per category, the `pricing_rules_set_updated_at` trigger with its function, and the single `reconciler_state` row; `0001_seed_pricing_rules.sql` seeds the three `type = 'ingestion'` pricing rules (the promotion-precedence rules are a separate set and arrive with the resolver, ADR-0004), and `0002_active_promotions.sql` creates the `active_promotions` view. Each table's Drizzle mirror lives in the module that owns it, under `db/schema/`, one file per table and per enum; `reconciler_state` sits under `src/workers/reconciler/db/schema/`. There is no barrel re-exporting them. Four of the objects above have no expression in it — the extension, the two exclusion constraints, the trigger with its function, and the seed row — so `npm run db:generate` would drop them; CI's "No schema drift" step does not catch that direction — a committed regeneration leaves a clean tree — so the integration tests, which assert each of the four directly, are what notices (ADR-0003). The view is not a fifth: drizzle-kit generated `0002` and its snapshot from `promotion/db/schema/active-promotions.ts`, and `npm run db:generate` reports no changes on a clean tree.

`active_promotions` is the one answer to which clock decides whether a promotion is running: `status = 'active' and tstzrange(starts_at, ends_at) @> now()`, evaluated by PostgreSQL, never re-derived in application code. The resolver (#36) selects from it instead of restating the predicate (ADR-0004, commit `1aaaffc`). The admin reads do not: `GET /api/promotions` has to show drafts, scheduled and expired promotions too, which the view by definition does not hold, so they project a five-valued `state` from the same half-open window in SQL (`src/modules/promotion/db/promotion-state-sql.ts`, PR #75). The range is half-open: a promotion is live the instant `starts_at` arrives and stops the instant `ends_at` does. `tests/integration/shared/db/active-promotions.test.ts` pins that boundary — it inserts and reads inside one transaction, where `now()` is `transaction_timestamp()` and therefore constant, so an inclusive upper bound fails the test instead of passing it unnoticed (commit `2142664`). It is not an endpoint; no route exposes it.

## Dynamic pricing rules

Ingestion prices every vendor row through `json-rules-engine` rules that live in the
`pricing_rules` table, not in code. Changing a markup is an `UPDATE`; no deploy, and a running import picks the new set up
within 60 seconds because the compiled set is cached for that long.

Migration `0001` seeds the three the case study asks for, applied in priority order:

| Priority | Rule                        | Condition                  | Adjustment |
| -------- | --------------------------- | -------------------------- | ---------- |
| 30       | electronics category markup | `category = 'Electronics'` | +15 %      |
| 20       | bulk stock discount         | `stockQuantity > 100`      | -3 %       |
| 10       | vendor commission           | every row                  | +5 %       |

An Electronics row at 80 000 cents with stock 150 therefore stores 93 702: 80 000 → 92 000 →
89 240 → 93 702, each step floored so rounding never favours the customer.

`BasePriceCalculator.fromRules(rows)` compiles the active rules once and rejects a rule that
cannot run — an unknown operator, a fact no vendor row carries, an empty condition group that
would fire on every row. `calculate(row)` then prices one row and returns either the price or
the rule that rejected it, never a throw. The code is `src/modules/pricing/domain/`.

## API

Every route is mounted under `/api` (ADR-0009). Request bodies are JSON, capped at 100 kB, and validated strictly: an unknown field is a `400`, never a silently dropped one. The Errors column lists the codes a route decides for itself; `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` and `INTERNAL` come from the shared boundary and can answer any of them.

| Method | Path                         | Description                                                                                                             | Errors                                                           |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/health`                | Liveness probe, returns `{"status":"ok"}`                                                                               | —                                                                |
| POST   | `/api/products`              | Create a product (`sku`, `name`, `category`, `basePriceCents`, `stockQuantity`); emits `product.upserted`               | `VALIDATION_ERROR`, `SKU_EXISTS`                                 |
| POST   | `/api/promotions`            | Create a promotion; with `productId` or `category` it is born `active`, with neither it is a `draft`                    | `VALIDATION_ERROR`, `PROMOTION_OVERLAP`                          |
| POST   | `/api/promotions/:id/assign` | Give a draft its one target (`productId` **or** `category`) and make it `active`                                        | `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `PROMOTION_OVERLAP` |
| POST   | `/api/promotions/:id/cancel` | Cancel a promotion and drop its scheduled boundaries; idempotent, so a second call also answers `200`                   | `NOT_FOUND`                                                      |
| GET    | `/api/promotions`            | List promotions, filtered and paged (`status`, `category`, `productId`, `limit`, `after`); returns `{ "items": [...] }` | `VALIDATION_ERROR`                                               |
| GET    | `/api/promotions/:id`        | One promotion                                                                                                           | `NOT_FOUND`                                                      |

`GET /api/promotions` takes five optional query parameters, combined with `AND`. Three are filters: `status` (`draft`, `active` or `cancelled`), `category` (exact match) and `productId`. Two page the result: `limit` (a positive integer, default `50`, maximum `100`) and `after`, a keyset cursor holding the last `id` of the previous page. The list is ordered by `id` and the response is `{ "items": [...] }` with no cursor of its own — the caller reads the last id it received, and a page shorter than `limit` is the end. Keyset rather than `OFFSET`, because `id` never changes, so a promotion created mid-read cannot make a page repeat or skip a row (REVIEW.md 5.5). There is no sort parameter: the storefront listing that needs one is a separate endpoint (PR #76). Filtering on the derived `state` is deliberately absent — that is a predicate on `now()`, and time predicates are PostgreSQL's (REVIEW.md 2.7).

Every promotion response carries both `status`, the value an admin set (`draft`, `active`, `cancelled`), and `state`, what the promotion is doing right now (`draft`, `scheduled`, `live`, `expired`, `cancelled`). `state` is computed by PostgreSQL in every read and in every write's `returning` clause (`src/modules/promotion/db/promotion-state-sql.ts`), never derived in TypeScript, so no Node clock can drift against it (ADR-0004).

Errors share one envelope, `{ "error": { "code", "message", "details"? } }`, with `code` drawn from a closed set — the `ErrorCode` type in `src/shared/http/error-code.ts`, and the compiler rejects anything outside it (ADR-0009):

| Code                     | Status | Meaning                                                                                                                              |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `VALIDATION_ERROR`       | 400    | Body, query or params rejected; `details` lists `{ path, message }` per field                                                        |
| `BAD_REQUEST`            | 400    | An exposed client error the body parser raised under a status with no wording of its own                                             |
| `NOT_FOUND`              | 404    | No such route, or no promotion with that id                                                                                          |
| `CONFLICT`               | 409    | The row is not in a state the operation accepts: assigning to a promotion that is not a draft, or to a draft whose window has passed |
| `SKU_EXISTS`             | 409    | A product with that SKU already exists                                                                                               |
| `PROMOTION_OVERLAP`      | 409    | Another active promotion covers that window; `details.conflictingPromotionId` names it, or is `null` if it was cancelled in between  |
| `PAYLOAD_TOO_LARGE`      | 413    | Body over the 100 kB cap                                                                                                             |
| `UNSUPPORTED_MEDIA_TYPE` | 415    | Body encoding the parser will not decode                                                                                             |
| `BACKPRESSURE`           | 429    | Queue depth over its bound (ADR-0007); carries `Retry-After`                                                                         |
| `INTERNAL`               | 500    | Server fault; the message is ours and the stack goes only to the log                                                                 |
| `READ_MODEL_NOT_READY`   | 503    | Read model not warm yet (ADR-0003); carries `Retry-After`                                                                            |

`PROMOTION_OVERLAP` is raised from SQLSTATE `23P01` — the two GiST exclusion constraints on `promotions` firing — never from a check-then-insert query: two admins creating the same window at once both pass such a check, so one of them has to lose in the database (ADR-0004). The conflicting id is looked up only after the violation, to fill in `details`.

An id that is not a positive integer answers `404`, not `400`: the caller named a promotion that does not exist rather than sending a bad body.

`src/server.ts` builds the pool and the queues from the configuration and passes `db`, `enqueue` and `boundaries` into `createApp`, so every route below is served by `npm run dev`. The routers are mounted only when those dependencies are present (`src/app-dependencies.ts`), which is what lets a test build an app with just the middleware — and is why an omission in `server.ts` would be a 404 in production with a green suite, the file being the one excluded from coverage (REVIEW.md 7.2).

The product and promotion endpoints land on PR #75 (`POST /api/products` in commit `3c35837`, issue #10; the promotion routes for issue #11). Storefront read endpoints are PR #76; the ingestion upload is ADR-0005's PR.

- **A 4xx explains itself; a 5xx does not.** A client error carries a message written for the caller. A server error never returns the message its handler wrote — that goes to the log. A 5xx answers with the status its code maps to, and keeps that code only where the API wrote public words for it: `READ_MODEL_NOT_READY` answers `503` with `"The read model is not ready yet; retry shortly"`, and any 5xx code without public wording answers `500 INTERNAL` (PR #30, commits `af38e0c`, `4f10c7f`, `a218bf2` and `9f27f8d`). The code-to-status list above is one-way — it is the status the API answers with for a code it raises, not a reverse map: a foreign client error keeps its own status and is given the nearest code, so a `418` answers `BAD_REQUEST` even though that code's own status is `400`. An unexpected error is returned as `500 INTERNAL` only — no internal detail reaches the client — and is logged under an `error` key as `{ type, message, stack, code }`, taken from the driver error underneath so no SQL text or bound parameter reaches the log either (ADR-0010).
- **Validation.** Request bodies, query strings and path parameters are validated at the boundary with strict zod schemas: an unknown field is a `400 VALIDATION_ERROR`, not a silently ignored typo. Strictness is top-level; a nested object declares its own with `z.strictObject(...)` (ADR-0009).
- **A rejection names where, and which of your own keys.** `details` is a list of `{ path, message }`. The path is generated by the API (`body`, `query`, `body.window`, `body.items[3].sku`) and points at what to fix. An unknown field is named — `Unrecognized keys (1): "basePriceCent"` — because you cannot correct a typo you cannot see; keys are truncated at 64 characters rather than omitted, the list is capped, and the count is given so a truncated list is visibly truncated. What never comes back is a **value**: neither one you sent nor one we store. `details` is capped at the first 20 issues. The same key names, bounded the same way and never their values, are also logged at `warn` with the correlation id so a fleet of clients misconfigured the same way shows up in one place (ADR-0009, PR #30, commits `de3bf9e`, `af38e0c`, `4f10c7f`, `a218bf2`, `ec623cc` and `30bc002`).
- **Request bodies** are capped at 100kb; a larger body is `413 PAYLOAD_TOO_LARGE`. A body that cannot be read is `400 VALIDATION_ERROR` whatever made it unreadable — malformed JSON, a connection dropped mid-upload, a body that will not decompress — and a charset the parser will not decode is `415 UNSUPPORTED_MEDIA_TYPE` (ADR-0009).
- **Correlation id.** Send `x-request-id` (matching `^[A-Za-z0-9._-]{1,128}$`) to trace a request; anything else is replaced by a generated uuid. The id used is returned in the `x-request-id` response header and appears as `reqId` on every JSON log line (ADR-0010).

## Development workflow

- **TDD**: every change starts with a failing test (red-green-refactor).
- **Conventional Commits** for all commit messages.
- All changes land through pull requests — no direct pushes to `main`.
- A PR merges only once the required checks `ci` and `claude-review` are green. `ci` runs the SonarCloud scan and waits for its quality gate; the scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not required. Every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- `local-gates` runs on every PR and computes which local-agent labels apply; it does not block the merge, but its labels are read at hand-off. When the checks are green, the threads are resolved and the labels are on, the PR is labelled `needs-human-check` and the owner is mentioned; merge happens only after the owner's approving comment, as a squash.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
