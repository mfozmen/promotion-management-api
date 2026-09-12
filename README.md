# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one active promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- BullMQ on Redis 7 (event bus; see [ADR-0003](./ADR.md))
- zod (payload validation at the queue boundary)
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16 and Redis 7 run locally from `docker-compose.yml`), plus one throwaway Redis on 6399 for the queue integration tests, which use no mocks (REVIEW.md 7.3)

## Getting started

```bash
npm ci
cp .env.example .env          # placeholders only; .env is gitignored
docker compose up -d --wait   # PostgreSQL on 5432, Redis on 6379, both healthy
npm run dev
```

Tests and checks. The queue and shutdown integration tests obliterate the queues
they use, so they run against their own Redis rather than the compose one;
override the port with `QUEUE_TEST_REDIS_URL`:

```bash
docker run -d --rm -p 6399:6379 redis:7-alpine
npm test
npm run test:cov
npm run lint
```

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data` and `redis-data` volumes as well.

### Configuration

`.env.example` lists every variable the application reads except `SHUTDOWN_TIMEOUT_MS`, which `src/server.ts` reads directly and which is in neither `.env.example` nor `config.ts` (ADR-0003); copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — but nothing calls it yet, so `npm run dev` currently starts without checking anything. The first module that opens a connection wires it in. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432 and 6379 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL` or `REDIS_URL` to match. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores and a browser for each behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. Issue #19 adds the application containers (api, event-handler, ingestion-worker, reconciler), the migration step and the `monitoring` profile on top of it, so that a single `docker compose up` brings the whole stack up. Its `api` service must publish the fixed host port 3000 and answer `/api/health`: that is what `.claude/agents/e2e-tester.md` brings up and measures against, and the port is fixed so two runs cannot measure the same machine at once. Nothing publishes 3000 until then.

### The queue

BullMQ uses Redis logical database 1, the `REDIS_QUEUE_DB` default, while
database 0 holds the read model, so queue maintenance and read-model rebuilds
cannot destroy each other (ADR-0007). `src/shared/queue.ts` takes that number as
a constant rather than from `src/shared/config.ts`, which nothing calls yet.

`npm run dev` opens the queue connections at startup against `REDIS_URL`
(default `redis://127.0.0.1:6379`), but it starts and serves without a Redis
there: connection errors are logged and every enqueue fails at its 2 s bound
rather than hanging. Connecting has its own 10 s budget. `SIGTERM` closes the
HTTP server first and the queues last, and waits at most `SHUTDOWN_TIMEOUT_MS`
(default 10 s, `0` exits immediately) for open connections before closing the
queues anyway (ADR-0003).

## Project structure

```
src/    application source code
tests/  automated tests (tests/unit, tests/integration, mirroring src/)
docs/   design specs (docs/superpowers/specs)
```

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
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check, and a Warning is fixed in the pull request that found it rather than filed as an issue.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
