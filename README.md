# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one active promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- zod (request validation at the boundary)
- pino + pino-http (structured JSON logging)
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

`npm run dev` starts the API on `PORT` (default `3000`); `GET http://localhost:3000/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file. No database, migrations, seed or ingestion command exist yet — they are documented here as they land (ADR-0003 makes the SQL migrations the DDL deliverable).

## Project structure

```
src/             app.ts (the Express app and the /api router), server.ts (the process entry point)
src/middleware/  error handler (the one JSON error envelope), request validator (zod at the boundary)
src/shared/      cross-cutting modules: logger.ts, http-error.ts
tests/unit/      unit tests; tests/ itself holds helpers both kinds import (capture-logger.ts)
docs/            design specs (docs/superpowers/specs)
```

`tests/integration/` and the module folders under `src/modules/` are named in the design spec and land with the endpoints that need them.

## API

All endpoints are mounted under the `/api` prefix (ADR-0008).

| Method | Path          | Description                               | Query parameters |
| ------ | ------------- | ----------------------------------------- | ---------------- |
| GET    | `/api/health` | Liveness probe, returns `{"status":"ok"}` | none             |

Further endpoints are documented as they land.

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
- A PR merges only once CI is green, the SonarCloud quality gate passes, the advisory Claude AI review has run, the applicable local-agent labels are present (`local-gates`, PR #21), and the owner has confirmed the `needs-human-check` hand-off.
- Merges to `main` are squash merges.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
