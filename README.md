# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one applied promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- zod (request and event-payload validation)
- pino + pino-http (structured JSON logging)
- PostgreSQL 16 write store, Drizzle ORM + drizzle-kit SQL migrations
- BullMQ on Redis 7 (event queue; see [ADR-0003](./ADR.md))
- json-rules-engine (the ingestion pricing rules, read from the database)
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16, Redis 7 and the `api` image built from this repository's `Dockerfile` all run locally from `docker-compose.yml`), plus one throwaway Redis on 6399 for the queue integration tests, which use no mocks (REVIEW.md 7.3)

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
docker run -d --rm -p 6399:6379 redis:7-alpine # only the integration layer needs it
npm test
npm run test:cov # needs a PostgreSQL and that Redis, see below
npm run lint
```

`npm run dev` starts the API on `PORT` (default `3100`); `GET http://localhost:3100/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file.

The suite is split into layers, so the one that needs nothing can run anywhere:

| Layer                              | Command                    | Needs                                 | Runs                        |
| ---------------------------------- | -------------------------- | ------------------------------------- | --------------------------- |
| unit (`tests/unit/`)               | `npm test`                 | nothing                               | pre-commit hook, everywhere |
| integration (`tests/integration/`) | `npm run test:integration` | real PostgreSQL and the Redis on 6399 | CI, before every push       |
| both, with coverage                | `npm run test:cov`         | the same two                          | CI (the 100 % gate)         |

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
makes an untracked new migration visible to the diff (ADR-0003).

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data` and `redis-data` volumes as well. An `e2e-tester` run never touches this stack: it puts `-p pma-e2e` on every compose command so its own volumes are the only ones it drops, and it stops rather than starting if you are holding 3100, 5432 or 6379.

### Configuration

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — and `src/server.ts` calls it before it migrates or listens, so a bad value stops the boot rather than the first request. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432, 6379 and 3100 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL`, `REDIS_URL` or `PORT` to match. `PORT` defaults to 3100 in both `src/shared/config.ts` and `.env.example`, and the compose healthcheck and published port name 3100 literally, so changing it for the container means changing all three together. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores, the `api` service built from this repository's `Dockerfile`, and a browser for each store behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. `api` publishes http://127.0.0.1:3100 and migrates before it serves, so `docker compose up -d --wait` returns only once the schema is current and the application is answering — there is no migration command to run and no `migrate` service any more. The port is 3100 rather than 3000 because 3000 is what every other Node service on a developer's machine takes. Issue #19 adds the remaining containers (event-handler, ingestion-worker, reconciler) and the `monitoring` profile on top of it.

### The queue

Four queues, one per urgency class, and `eventRouting` maps an event to one of
them — the caller never picks. `promotions` carries `promotion.changed` and the
delayed boundary jobs, `catalog` carries `product.upserted`, `ingestion` carries
`ingestion.chunk`, and `maintenance` carries `readmodel.rebuild` and
`reconciler.run`. The partition is what keeps a 500 000-row import's ~500
announcements, or a full read-model rebuild, from sitting in front of a flash
sale's `promotion.changed`: each queue gets its own worker, so two events that
need different priority get different consumers rather than a priority number
inside one queue (ADR-0003).

BullMQ uses the logical database `REDIS_QUEUE_DB` names, while `REDIS_READ_MODEL_DB`
holds the read model, so queue maintenance and read-model rebuilds cannot destroy
each other (ADR-0007). `src/server.ts` reads both from `src/shared/config.ts` and
passes the queue one to `EventQueue.connect`, which is what makes the configuration
check that they differ mean something.

`npm run dev` opens the queue connections at startup against `REDIS_URL`, which
has no default and is required (`.env.example` sets the compose one), but it
starts and serves without a Redis
there: connection errors are logged and every publish fails at its 2 s bound
rather than hanging. Connecting has its own 10 s budget. `SIGTERM` closes the
HTTP server first and the queues last, and waits at most `SHUTDOWN_DRAIN_TIMEOUT_MS`
(default 10 s; digits only, so a blank value is rejected rather than read as the
`0` that exits immediately) for open connections before closing the
queues anyway (ADR-0003).

## Project structure

Directories are named for a role and a file holds one exported declaration named after it. The tree and the naming rules are in [CONTRIBUTING.md](./CONTRIBUTING.md) under "Source layout"; this file does not repeat them.

Directories are named for a role and a file holds one exported declaration named after it (REVIEW.md 8c.2, 8c.7).

Inside a layer the tree mirrors `src/`, one test file per source file. Every test file now imports its subject through the `@src/*` alias, (`tsconfig.json` `paths` + `vitest.workspace.ts`, which declares the alias once and spreads it into both projects — a workspace project does not inherit the root `vitest.config.ts` `resolve` block, so an alias declared only there fails every aliased import at load time); production code under `src/` uses relative specifiers and never the alias, because `tsc` does not rewrite path aliases on emit — an ESLint rule enforces that boundary ([CONTRIBUTING.md](./CONTRIBUTING.md)).

## Database schema

The DDL is the migration set in [`src/shared/db/migrations/`](./src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the five enums, the six tables, the two GiST exclusion constraints that enforce one active promotion per product and per category, the `pricing_rules_set_updated_at` trigger with its function, and the single `reconciler_state` row; `0001_seed_pricing_rules.sql` seeds the three `type = 'ingestion'` pricing rules (the promotion-precedence rules are a separate set and arrive with the resolver, ADR-0004), and `0002_active_promotions.sql` creates the `active_promotions` view. Each table's Drizzle mirror lives in the module that owns it, under `db/schema/`, one file per table and per enum; `reconciler_state` sits under `src/workers/reconciler/db/schema/`. There is no barrel re-exporting them. Four of the objects above have no expression in it — the extension, the two exclusion constraints, the trigger with its function, and the seed row — so `npm run db:generate` would drop them; CI's "No schema drift" step does not catch that direction — a committed regeneration leaves a clean tree — so the integration tests, which assert each of the four directly, are what notices (ADR-0003). The view is not a fifth: drizzle-kit generated `0002` and its snapshot from `promotion/db/schema/active-promotions.ts`, and `npm run db:generate` reports no changes on a clean tree.

`active_promotions` is the one answer to which clock decides whether a promotion is running: `status = 'active' and tstzrange(starts_at, ends_at) @> now()`, evaluated by PostgreSQL, never re-derived in application code. The resolver (#36) and the admin reads will select from it instead of restating the predicate (ADR-0004, commit `1aaaffc`). The range is half-open: a promotion is live the instant `starts_at` arrives and stops the instant `ends_at` does. `tests/integration/shared/db/active-promotions.test.ts` pins that boundary — it inserts and reads inside one transaction, where `now()` is `transaction_timestamp()` and therefore constant, so an inclusive upper bound fails the test instead of passing it unnoticed. It is not an endpoint; no route exposes it.

`tests/integration/` and the module folders under `src/modules/` are named in the design spec and land with the endpoints that need them.

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

All endpoints are mounted under the `/api` prefix (ADR-0009).

| Method | Path          | Description                               | Query parameters |
| ------ | ------------- | ----------------------------------------- | ---------------- |
| GET    | `/api/health` | Liveness probe, returns `{"status":"ok"}` | none             |

Further endpoints are documented as they land. The design spec puts every route under `/api` (`docs/superpowers/specs/2026-09-12-domain-design.md`), and the health route moved from `GET /health` to `GET /api/health` with the boundary (ADR-0009), so the prefix holds for everything that ships today.

### Conventions

- **Errors.** Every failure returns `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. `code` comes from a closed set — `VALIDATION_ERROR` (400), `BAD_REQUEST` (any other client error), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `BACKPRESSURE` (429), `INTERNAL` (500), `READ_MODEL_NOT_READY` (503) — so a client can branch on a finite list; the set is the `ErrorCode` type in `src/shared/http/error-code.ts` and the compiler rejects anything outside it (ADR-0009).
- **A 4xx explains itself; a 5xx does not.** A client error carries a message written for the caller. A server error never returns the message its handler wrote — that goes to the log. A 5xx answers with the status its code maps to, and keeps that code only where the API wrote public words for it: `READ_MODEL_NOT_READY` answers `503` with `"The read model is not ready yet; retry shortly"`, and any 5xx code without public wording answers `500 INTERNAL`. The code-to-status list above is one-way — it is the status the API answers with for a code it raises, not a reverse map: a foreign client error keeps its own status and is given the nearest code, so a `418` answers `BAD_REQUEST` even though that code's own status is `400`. An unexpected error is returned as `500 INTERNAL` only — no internal detail reaches the client — and is logged under an `error` key as `{ type, message, stack, code }` (ADR-0010).
- **Validation.** Request bodies, query strings and path parameters are validated at the boundary with strict zod schemas: an unknown field is a `400 VALIDATION_ERROR`, not a silently ignored typo. Strictness is top-level; a nested object declares its own with `z.strictObject(...)` (ADR-0009).
- **A rejection names where, and which of your own keys.** `details` is a list of `{ path, message }`. The path is generated by the API (`body`, `query`, `body.window`, `body.items[3].sku`) and points at what to fix. An unknown field is named — `Unrecognized keys (1): "basePriceCent"` — because you cannot correct a typo you cannot see; keys are truncated at 64 characters rather than omitted, the list is capped, and the count is given so a truncated list is visibly truncated. What never comes back is a **value**: neither one you sent nor one we store. `details` is capped at the first 20 issues.
- **Request bodies** are capped at 100kb; a larger body is `413 PAYLOAD_TOO_LARGE`. A body that cannot be read is `400 VALIDATION_ERROR` whatever made it unreadable — malformed JSON, a connection dropped mid-upload, a body that will not decompress — and a charset the parser will not decode is `415 UNSUPPORTED_MEDIA_TYPE` (ADR-0009).
- **Correlation id.** Send `x-request-id` (matching `^[A-Za-z0-9._-]{1,128}$`) to trace a request; anything else is replaced by a generated uuid. The id used is returned in the `x-request-id` response header and appears as `reqId` on every JSON log line (ADR-0010).

## Development workflow

- **TDD**: every change starts with a failing test (red-green-refactor).
- **Conventional Commits** for all commit messages.
- All changes land through pull requests — no direct pushes to `main`.
- A PR merges only once the required checks `ci` and `claude-review` are green. `ci` runs the SonarCloud scan and waits for its quality gate; the scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not required. Every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- `local-gates` runs on every PR and computes which local-agent labels apply; it does not block the merge, but its labels are read at hand-off. When the checks are green, the threads are resolved and the labels are on, the PR is labelled `needs-human-check` and the owner is mentioned; merge happens only after the owner's approving comment, as a squash.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check, and a Warning is fixed in the pull request that found it rather than filed as an issue.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
