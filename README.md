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

The integration tests read Redis on database 9 and PostgreSQL through the same compose stack, so `docker compose up -d --wait` has to be running before `npm run test:integration`; `TEST_REDIS_URL` and `TEST_DATABASE_URL` override the defaults.

Tests and checks:

```bash
npm test
npm run test:cov # needs a PostgreSQL, see below
npm run lint
```

`npm run dev` starts the API on `PORT` (default `3100`); `GET http://localhost:3100/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file.

The suite is split into layers, so the one that needs nothing can run anywhere:

| Layer                              | Command                    | Needs           | Runs                        |
| ---------------------------------- | -------------------------- | --------------- | --------------------------- |
| unit (`tests/unit/`)               | `npm test`                 | nothing         | pre-commit hook, everywhere |
| integration (`tests/integration/`) | `npm run test:integration` | real PostgreSQL | CI, before every push       |
| both, with coverage                | `npm run test:cov`         | real PostgreSQL | CI (the 100 % gate)         |

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
migrations with `npm run db:generate` after changing `src/shared/db/schema/`, and apply
them to a running database with `DATABASE_URL=... npm run db:migrate` (drizzle-kit reads
`DATABASE_URL`, not `TEST_DATABASE_URL`, and falls back to
`postgres://postgres:postgres@localhost:5432/promotion` when it is unset, which is not the
compose server's role). CI's "No schema drift" step runs `npm run db:generate < /dev/null`,
checks the tool's own success line, then `git add -AN src/shared/db/migrations` and
`git diff --exit-code src/shared/db/migrations`, so a schema change committed without its
migration fails the build. It reads the success line rather than the exit code because
`drizzle-kit generate` exits 0 even when it fails and writes nothing; `git add -AN` is what
makes an untracked new migration visible to the diff (ADR-0003, commit `c14fa50`).

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data` and `redis-data` volumes as well.

### Configuration

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — and `src/server.ts` calls it before it migrates or listens, so a bad value stops the boot rather than the first request. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432, 6379 and 3100 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL`, `REDIS_URL` or `PORT` to match. `PORT` defaults to 3100 in both `src/shared/config.ts` and `.env.example`, and the compose healthcheck and published port name 3100 literally, so changing it for the container means changing all three together. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores, the `api` service built from this repository's `Dockerfile`, and a browser for each store behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. `api` publishes http://127.0.0.1:3100 and migrates before it serves, so `docker compose up -d --wait` returns only once the schema is current and the application is answering — there is no migration command to run and no `migrate` service any more. The port is 3100 rather than 3000 because 3000 is what every other Node service on a developer's machine takes. Issue #19 adds the remaining containers (event-handler, ingestion-worker, reconciler) and the `monitoring` profile on top of it.

## Project structure

```
src/                app.ts (the Express app and the /api router), server.ts (the process entry point)
src/modules/        one directory per module, with domain/, db/ and http/ as it needs them
src/shared/db/      the Drizzle schema, client and SQL migrations
src/shared/http/    the HTTP boundary: the error type and its status table, the error handler,
                    the not-found handler, the request validator and the request logger
src/shared/         config.ts, logger.ts (the root logger and the error whitelist every log site
                    uses), and http/ above
tests/              unit, integration and e2e, each layer mirroring src/
docs/               design specs (docs/superpowers/specs), end-to-end cases (docs/e2e-cases)
```

Directories are named for a role and a file holds one exported declaration named after it (REVIEW.md 8c.2, 8c.7). A helper both test layers import sits at `tests/<subject>-<role>.ts` (7.7).

Inside a layer the tree mirrors `src/`, one test file per source file. Every test file now imports its subject through the `@src/*` alias, the last six having moved off relative specifiers in `ba5c2ca` (`tsconfig.json` `paths` + `vitest.workspace.ts`, which declares the alias once and spreads it into both projects — a workspace project does not inherit the root `vitest.config.ts` `resolve` block, so an alias declared only there fails every aliased import at load time; PR #50, commit `75130b7`); production code under `src/` uses relative specifiers and never the alias, because `tsc` does not rewrite path aliases on emit — an ESLint rule enforces that boundary ([CONTRIBUTING.md](./CONTRIBUTING.md)).

## Database schema

The DDL is the migration set in [`src/shared/db/migrations/`](./src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the five enums, the six tables, the two GiST exclusion constraints that enforce one active promotion per product and per category, the `pricing_rules_set_updated_at` trigger with its function, and the single `reconciler_state` row; `0001_seed_pricing_rules.sql` seeds the three `type = 'ingestion'` pricing rules (the promotion-precedence rules are a separate set and arrive with #36, ADR-0004), and `0002_active_promotions.sql` creates the `active_promotions` view. [`src/shared/db/schema/`](./src/shared/db/schema) is the Drizzle mirror used by queries, one file per table, per enum and one for the view, with the barrel `schema.ts` beside the directory rather than in it, so drizzle-kit does not scan the re-exports and register the view twice (commits `1aaaffc`, `10b326c`, PR #50). Four of the objects above have no expression in it — the extension, the two exclusion constraints, the trigger with its function, and the seed row — so `npm run db:generate` would drop them; CI's "No schema drift" step does not catch that direction — a committed regeneration leaves a clean tree — so the integration tests, which assert each of the four directly, are what notices (ADR-0003, commits `489bc27`, `ba5c2ca`, `888e632`). The view is not a fifth: drizzle-kit generated `0002` and its snapshot from `schema/active-promotions.ts`, and `npm run db:generate` reports no changes on a clean tree (commit `10b326c`).

`active_promotions` is the one answer to which clock decides whether a promotion is running: `status = 'active' and tstzrange(starts_at, ends_at) @> now()`, evaluated by PostgreSQL, never re-derived in application code. The resolver (#36) and the admin reads will select from it instead of restating the predicate (ADR-0004, commit `1aaaffc`). The range is half-open: a promotion is live the instant `starts_at` arrives and stops the instant `ends_at` does. `tests/integration/shared/db/active-promotions.test.ts` pins that boundary — it inserts and reads inside one transaction, where `now()` is `transaction_timestamp()` and therefore constant, so an inclusive upper bound fails the test instead of passing it unnoticed (commit `2142664`). It is not an endpoint; no route exposes it.

`tests/integration/` and the module folders under `src/modules/` are named in the design spec and land with the endpoints that need them.

## API

All endpoints are mounted under the `/api` prefix (ADR-0008).

| Method | Path          | Description                               | Query parameters |
| ------ | ------------- | ----------------------------------------- | ---------------- |
| GET    | `/api/health` | Liveness probe, returns `{"status":"ok"}` | none             |

Further endpoints are documented as they land. The design spec puts every route under `/api` (`docs/superpowers/specs/2026-09-12-domain-design.md`), and the health route moved from `GET /health` to `GET /api/health` with the boundary (ADR-0008, PR #30, commit `7fd588e`), so the prefix holds for everything that ships today.

### Conventions

- **Errors.** Every failure returns `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. `code` comes from a closed set — `VALIDATION_ERROR` (400), `BAD_REQUEST` (any other client error), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `BACKPRESSURE` (429), `INTERNAL` (500), `READ_MODEL_NOT_READY` (503) — so a client can branch on a finite list; the set is the `ErrorCode` type in `src/shared/http/error-code.ts` and the compiler rejects anything outside it (ADR-0008).
- **A 4xx explains itself; a 5xx does not.** A client error carries a message written for the caller. A server error never returns the message its handler wrote — that goes to the log. A 5xx answers with the status its code maps to, and keeps that code only where the API wrote public words for it: `READ_MODEL_NOT_READY` answers `503` with `"The read model is not ready yet; retry shortly"`, and any 5xx code without public wording answers `500 INTERNAL` (PR #30, commits `af38e0c`, `4f10c7f`, `a218bf2` and `9f27f8d`). The code-to-status list above is one-way — it is the status the API answers with for a code it raises, not a reverse map: a foreign client error keeps its own status and is given the nearest code, so a `418` answers `BAD_REQUEST` even though that code's own status is `400`. An unexpected error is returned as `500 INTERNAL` only — no internal detail reaches the client — and is logged under an `error` key as `{ type, message, stack, code }`, taken from the driver error underneath so no SQL text or bound parameter reaches the log either (ADR-0009).
- **Validation.** Request bodies, query strings and path parameters are validated at the boundary with strict zod schemas: an unknown field is a `400 VALIDATION_ERROR`, not a silently ignored typo. Strictness is top-level; a nested object declares its own with `z.strictObject(...)` (ADR-0008).
- **A rejection names where, and which of your own keys.** `details` is a list of `{ path, message }`. The path is generated by the API (`body`, `query`, `body.window`, `body.items[3].sku`) and points at what to fix. An unknown field is named — `Unrecognized keys (1): "basePriceCent"` — because you cannot correct a typo you cannot see; keys are truncated at 64 characters rather than omitted, the list is capped, and the count is given so a truncated list is visibly truncated. What never comes back is a **value**: neither one you sent nor one we store. `details` is capped at the first 20 issues. The same key names, bounded the same way and never their values, are also logged at `warn` with the correlation id so a fleet of clients misconfigured the same way shows up in one place (ADR-0008, PR #30, commits `de3bf9e`, `af38e0c`, `4f10c7f`, `a218bf2`, `ec623cc` and `30bc002`).
- **Request bodies** are capped at 100kb; a larger body is `413 PAYLOAD_TOO_LARGE`. A body that cannot be read is `400 VALIDATION_ERROR` whatever made it unreadable — malformed JSON, a connection dropped mid-upload, a body that will not decompress — and a charset the parser will not decode is `415 UNSUPPORTED_MEDIA_TYPE` (ADR-0008).
- **Correlation id.** Send `x-request-id` (matching `^[A-Za-z0-9._-]{1,128}$`) to trace a request; anything else is replaced by a generated uuid. The id used is returned in the `x-request-id` response header and appears as `reqId` on every JSON log line (ADR-0009).

## Development workflow

- **TDD**: every change starts with a failing test (red-green-refactor).
- **Conventional Commits** for all commit messages.
- All changes land through pull requests — no direct pushes to `main`.
- A PR merges only once the required checks `ci` and `claude-review` are green. `ci` runs the SonarCloud scan and waits for its quality gate; the scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not required. Every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- `local-gates` runs on every PR and computes which local-agent labels apply; it does not block the merge, but its labels are read at hand-off. When the checks are green, the threads are resolved and the labels are on, the PR is labelled `needs-human-check` and the owner is mentioned; merge happens only after the owner's approving comment, as a squash.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
