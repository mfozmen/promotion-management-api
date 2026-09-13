# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one active promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- PostgreSQL 16 write store, Drizzle ORM + drizzle-kit SQL migrations
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16 and Redis 7 run locally from `docker-compose.yml`)

## Getting started

```bash
npm ci
cp .env.example .env          # placeholders only; .env is gitignored
docker compose up -d --wait   # PostgreSQL on 5432, Redis on 6379, schema migrated
npm run dev
```

Migrating is not a step anyone has to remember: the `migrate` one-shot service applies `src/shared/db/migrations/` as part of `up`, and `--wait` does not return until it has exited cleanly. That single step creates the tables, constraints and the `active_promotions` view and seeds the `type = 'ingestion'` pricing rules of migration `0001`; there is no separate seed step. A failed migration is not retried — the service carries `restart: 'no'` — so `up -d --wait` exits non-zero with PostgreSQL and Redis running and the schema partially applied. Read the cause with `docker compose logs migrate`, fix it, and re-run the migration with `docker compose up migrate`, which attaches to that one service and hands back the migration's own exit status. A second `up -d` would also restart the exited container — `restart: 'no'` only stops the daemon retrying it, it does not stop `up` starting it again — but it re-waits on the whole stack and reports a detached `--wait` error rather than the migration's (ADR-0003). It is a stopgap — once the `api` image lands (issue #19) the migration moves into that image's entrypoint and the one-shot service goes, so the two never both run migrations.

`npm run db:migrate` does the same thing from the host against whatever `DATABASE_URL` names, for a database that is not the compose one (`drizzle.config.ts` reads it from the environment, not from `.env`). There is no ingestion command yet; the upload endpoint and chunk worker arrive with issue #16.

Tests and checks:

```bash
npm test
npm run test:cov # needs a PostgreSQL, see below
npm run lint
```

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

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — but nothing calls it yet, so `npm run dev` currently starts without checking anything. The first module that opens a connection wires it in. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432 and 6379 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL` or `REDIS_URL` to match. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores and the `migrate` one-shot service, plus a browser for each store behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. Issue #19 adds the application containers (api, event-handler, ingestion-worker, reconciler) and the `monitoring` profile on top of it, so that a single `docker compose up` brings the whole stack up, and moves migrating out of the `migrate` service into the `api` image's entrypoint. Its `api` service must publish the fixed host port 3000 and answer `/api/health`: that is what `.claude/agents/e2e-tester.md` brings up and measures against, and the port is fixed so two runs cannot measure the same machine at once. Nothing publishes 3000 until then.

## Project structure

```
src/    application source code (src/shared/db holds the Drizzle schema, client and SQL migrations)
tests/  automated tests (unit, integration, e2e), each layer mirroring src/
docs/   design specs (docs/superpowers/specs), end-to-end cases (docs/e2e-cases)
```

Inside a layer the tree mirrors `src/`, one test file per source file. Every test file now imports its subject through the `@src/*` alias, the last six having moved off relative specifiers in `ba5c2ca` (`tsconfig.json` `paths` + `vitest.workspace.ts`, which declares the alias once and spreads it into both projects — a workspace project does not inherit the root `vitest.config.ts` `resolve` block, so an alias declared only there fails every aliased import at load time; PR #50, commit `75130b7`); production code under `src/` uses relative specifiers and never the alias, because `tsc` does not rewrite path aliases on emit — an ESLint rule enforces that boundary ([CONTRIBUTING.md](./CONTRIBUTING.md)).

## Database schema

The DDL is the migration set in [`src/shared/db/migrations/`](./src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the five enums, the six tables, the two GiST exclusion constraints that enforce one active promotion per product and per category, the `pricing_rules_set_updated_at` trigger with its function, and the single `reconciler_state` row; `0001_seed_pricing_rules.sql` seeds the three `type = 'ingestion'` pricing rules (the promotion-precedence rules are a separate set and arrive with #36, ADR-0004), and `0002_active_promotions.sql` creates the `active_promotions` view. [`src/shared/db/schema/`](./src/shared/db/schema) is the Drizzle mirror used by queries, one file per table, per enum and one for the view, with the barrel `schema.ts` beside the directory rather than in it, so drizzle-kit does not scan the re-exports and register the view twice (commits `1aaaffc`, `10b326c`, PR #50). Four of the objects above have no expression in it — the extension, the two exclusion constraints, the trigger with its function, and the seed row — so `npm run db:generate` would drop them; CI's "No schema drift" step does not catch that direction — a committed regeneration leaves a clean tree — so the integration tests, which assert each of the four directly, are what notices (ADR-0003, commits `489bc27`, `ba5c2ca`, `888e632`). The view is not a fifth: drizzle-kit generated `0002` and its snapshot from `schema/active-promotions.ts`, and `npm run db:generate` reports no changes on a clean tree (commit `10b326c`).

`active_promotions` is the one answer to which clock decides whether a promotion is running: `status = 'active' and tstzrange(starts_at, ends_at) @> now()`, evaluated by PostgreSQL, never re-derived in application code. The resolver (#36) and the admin reads will select from it instead of restating the predicate (ADR-0004, commit `1aaaffc`). The range is half-open: a promotion is live the instant `starts_at` arrives and stops the instant `ends_at` does. `tests/integration/shared/db/active-promotions.test.ts` pins that boundary — it inserts and reads inside one transaction, where `now()` is `transaction_timestamp()` and therefore constant, so an inclusive upper bound fails the test instead of passing it unnoticed (commit `2142664`). It is not an endpoint; no route exposes it.

## API

| Method | Path      | Description                               |
| ------ | --------- | ----------------------------------------- |
| GET    | `/health` | Liveness probe, returns `{"status":"ok"}` |

Further endpoints are documented as they land. The design spec puts every route under `/api` (`docs/superpowers/specs/2026-09-12-domain-design.md`); the scaffold health route still sits at `/health` and moves with the `api` service in issue #19.

## Development workflow

- **TDD**: every change starts with a failing test (red-green-refactor).
- **Conventional Commits** for all commit messages.
- All changes land through pull requests — no direct pushes to `main`.
- A PR merges only once the required checks `ci` and `claude-review` are green. `ci` runs the SonarCloud scan and waits for its quality gate; the scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not required. Every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- `local-gates` runs on every PR and computes which local-agent labels apply; it does not block the merge, but its labels are read at hand-off. When the checks are green, the threads are resolved and the labels are on, the PR is labelled `needs-human-check` and the owner is mentioned; merge happens only after the owner's approving comment, as a squash.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
