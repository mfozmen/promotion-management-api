# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one active promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- zod (request validation at the HTTP boundary, payload validation at the queue boundary)
- pino + pino-http (structured JSON logging)
- PostgreSQL 16 write store, Drizzle ORM + drizzle-kit SQL migrations
- BullMQ on Redis 7 (event bus; see [ADR-0003](./ADR.md))
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16 and Redis 7 run locally from `docker-compose.yml`); the integration tests use both, never a mock (REVIEW.md 7.3)

## Getting started

```bash
npm ci
cp .env.example .env          # placeholders only; .env is gitignored
docker compose up -d --wait   # PostgreSQL on 5432, Redis on 6379, both healthy
npm run dev
```

Tests and checks:

```bash
npm test
npm run test:cov # needs PostgreSQL and Redis, see below
npm run lint
```

`npm run dev` starts the API on `PORT` (default `3000`); `GET http://localhost:3000/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file. The migrations are the DDL deliverable (ADR-0003); there is no seed or ingestion command yet, and both are documented here as they land.

The suite is split into layers, so the one that needs nothing can run anywhere:

| Layer                              | Command                    | Needs           | Runs                        |
| ---------------------------------- | -------------------------- | --------------- | --------------------------- |
| unit (`tests/unit/`)               | `npm test`                 | nothing         | pre-commit hook, everywhere |
| integration (`tests/integration/`) | `npm run test:integration` | real PostgreSQL and Redis | CI, before every push       |
| both, with coverage                | `npm run test:cov`         | real PostgreSQL and Redis | CI (the 100 % gate)         |

The integration tests run against a real PostgreSQL, never a mock. Point them at one with
`TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:55432/promotion`); a
throwaway server is one command away:

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
migrations with `npm run db:generate` after changing `src/shared/db/schema.ts`, and apply
them to a running database with `DATABASE_URL=... npm run db:migrate` (drizzle-kit reads
`DATABASE_URL`, not `TEST_DATABASE_URL`, and defaults to port 5432).

BullMQ uses Redis logical database 1; database 0 is reserved for the read
model, so queue maintenance and read-model rebuilds cannot destroy each other
(ADR-0007).

`npm run dev` opens the queue connections at startup against `REDIS_URL`
(default `redis://127.0.0.1:6379`), but it starts and serves without a Redis
there: connection errors are logged and every enqueue fails at its 2 s bound
rather than hanging. Connecting has its own 10 s budget. `SIGTERM` closes the HTTP server first and the queues last, and
waits at most `SHUTDOWN_TIMEOUT_MS` (default 10 s, `0` exits immediately) for
open connections before closing the queues anyway (ADR-0003).

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data` and `redis-data` volumes as well.

### Configuration

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — but nothing calls it yet, so `npm run dev` currently starts without checking anything. The first module that opens a connection wires it in. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432 and 6379 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL` or `REDIS_URL` to match. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores and a browser for each behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. Issue #19 adds the application containers (api, event-handler, ingestion-worker, reconciler), the migration step and the `monitoring` profile on top of it, so that a single `docker compose up` brings the whole stack up. Its `api` service must publish the fixed host port 3000 and answer `/api/health`: that is what `.claude/agents/e2e-tester.md` brings up and measures against, and the port is fixed so two runs cannot measure the same machine at once. Nothing publishes 3000 until then.

## Project structure

```
<<<<<<< HEAD
src/             app.ts (the Express app and the /api router), server.ts (the process entry point)
src/middleware/  error handler (the one JSON error envelope), request validator (zod at the boundary)
src/shared/      cross-cutting modules: logger.ts, http-error.ts; db/ holds the Drizzle schema, client and SQL migrations
tests/unit/      unit tests; tests/integration/ needs a real PostgreSQL and Redis; tests/ itself holds helpers both kinds import (capture-logger.ts)
docs/            design specs (docs/superpowers/specs), end-to-end case files (docs/e2e-cases)
```

The module folders under `src/modules/` are named in the design spec and land with the endpoints that need them.

## Database schema

The DDL is the migration set in [`src/shared/db/migrations/`](./src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the enums, the six tables and the two GiST exclusion constraints that enforce one active promotion per product and per category; `0001_seed_pricing_rules.sql` seeds the three ingestion pricing rules. [`src/shared/db/schema.ts`](./src/shared/db/schema.ts) is the Drizzle mirror used by queries — it cannot express the exclusion constraints, so those live in the migration only (ADR-0003).
=======
src/    application source code
tests/  automated tests (unit, integration, e2e), each layer mirroring src/
docs/   design specs (docs/superpowers/specs), end-to-end cases (docs/e2e-cases)
```

Inside a layer the tree mirrors `src/`, one test file per source file. Tests import their subject through the `@src/*` alias (`tsconfig.json` `paths` + `vitest.config.ts` `resolve.alias`); production code under `src/` uses relative specifiers and never the alias, because `tsc` does not rewrite path aliases on emit — an ESLint rule enforces that boundary ([CONTRIBUTING.md](./CONTRIBUTING.md)).
>>>>>>> origin/main

## API

All endpoints are mounted under the `/api` prefix (ADR-0008).

| Method | Path          | Description                               | Query parameters |
| ------ | ------------- | ----------------------------------------- | ---------------- |
| GET    | `/api/health` | Liveness probe, returns `{"status":"ok"}` | none             |

Further endpoints are documented as they land. The design spec puts every route under `/api` (`docs/superpowers/specs/2026-09-12-domain-design.md`); the scaffold health route still sits at `/health` and moves with the `api` service in issue #19.

### Conventions

- **Errors.** Every failure returns `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. `code` comes from a closed set — `VALIDATION_ERROR` (400), `BAD_REQUEST` (any other client error), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `BACKPRESSURE` (429), `INTERNAL` (500), `READ_MODEL_NOT_READY` (503) — so a client can branch on a finite list; the set is the `ErrorCode` type in `src/shared/http-error.ts` and the compiler rejects anything outside it (ADR-0008).
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
- `local-gates` runs on every PR and computes which local-agent labels apply; it does not block the merge, but its labels are read at hand-off. When the checks are green, the threads are resolved and the labels are on, the PR is labelled `needs-human-check` and the owner is mentioned; merge happens only after the owner's approving comment, as a squash. The owner cannot approve their own PR, so that comment is the merge signal rather than a GitHub review approval.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check, and a Warning is fixed in the pull request that found it rather than filed as an issue.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
