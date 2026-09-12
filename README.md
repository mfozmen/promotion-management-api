# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one active promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)

## Getting started

```bash
npm ci
npm run dev
npm test
npm run test:cov
npm run lint
```

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
- A PR merges only once CI is green — CI runs the SonarCloud scan and waits for its quality gate, and the scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not a required check — every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)), the advisory Claude AI review has run, and at least one human reviewer has approved.
- Merges to `main` are squash merges.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
