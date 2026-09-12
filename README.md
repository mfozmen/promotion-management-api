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
- Docker, for the Redis the queue integration tests use (no mocks, REVIEW.md 7.3)

## Getting started

```bash
npm ci
npm run dev

# Redis for the queue integration tests; override the port with QUEUE_TEST_REDIS_URL
docker run -d --rm -p 6399:6379 redis:7-alpine
npm test
npm run test:cov
npm run lint
```

BullMQ uses Redis logical database 1; database 0 is reserved for the read
model, so queue maintenance and read-model rebuilds cannot destroy each other
(ADR-0007).

`npm run dev` opens the queue connections at startup against `REDIS_URL`
(default `redis://127.0.0.1:6379`), but it starts and serves without a Redis
there: connection errors are logged and every enqueue fails at its 2 s bound
rather than hanging. Connecting has its own 10 s budget. `SIGTERM` closes the HTTP server first and the queues last, and
waits at most `SHUTDOWN_TIMEOUT_MS` (default 10 s, `0` exits immediately) for
open connections before closing the queues anyway (ADR-0003).

## Project structure

```
src/    application source code
tests/  automated tests (unit, integration)
docs/   design specs (docs/superpowers/specs)
```

## API

| Method | Path      | Description                               |
| ------ | --------- | ----------------------------------------- |
| GET    | `/health` | Liveness probe, returns `{"status":"ok"}` |

Further endpoints are documented as they land.

## Development workflow

- **TDD**: every change starts with a failing test (red-green-refactor).
- **Conventional Commits** for all commit messages.
- All changes land through pull requests — no direct pushes to `main`.
- Two checks are required on `main`: `ci` (lint, typecheck, tests at 100 % coverage, and the SonarCloud scan, which waits for its quality gate) and `claude-review` (advisory AI review). The scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not required; every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- `local-gates` still runs and prints the agent labels it computed from the changed paths, but it does not block the merge; the pre-push agent rounds and their labels are the gate in practice.
- A PR is handed to the repository owner only once the required checks are green and no review thread is unresolved; it merges after the owner posts their approval, as a squash merge.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check, and a Warning is fixed in the pull request that found it rather than filed as an issue.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
