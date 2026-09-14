# ModaCo - Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for an e-commerce catalogue with time-bound promotions: a storefront that lists and
filters products by effective price, an admin surface that creates, assigns and cancels
percentage or fixed-value promotions with at most one applied per product, and a vendor import
that takes a 500 000-row file on a container limited to 256 MiB.

Writes go to PostgreSQL, reads are served from a Redis read model, and the two are kept in step
by a BullMQ queue and a reconciler that repairs what the queue cannot. The reasoning behind every
such choice is in [ADR.md](./ADR.md), which is the document to read after this one.

## Topology

Four application containers share two stores. Everything a shopper reads comes from the Redis
read model, everything anyone writes lands in PostgreSQL, and the queue is the only thing that
connects the two.

```mermaid
flowchart LR
  shopper([Shopper]):::actor --> api
  admin([Admin]):::actor --> api
  vendor([Vendor]):::actor -- "CSV upload" --> api

  subgraph application["Application (one image, four commands)"]
    api["api :3100<br/>REST, Bull Board, /metrics"]
    handler["event-handler<br/>products, promotions"]
    ingestion["ingestion-worker<br/>ingestion"]
    reconciler["reconciler<br/>maintenance"]
  end

  subgraph stores["Stores"]
    postgres[("PostgreSQL 16<br/>system of record")]
    queue[("Redis db 1<br/>BullMQ queues")]
    readmodel[("Redis db 0<br/>read model")]
    uploads[/"uploads volume"/]
  end

  subgraph monitoring["Monitoring (profile)"]
    prometheus["Prometheus :9090<br/>alert rules"]
    grafana["Grafana :3001"]
  end

  api -- "writes" --> postgres
  api -- "listings" --> readmodel
  api -- "publishes" --> queue
  api -- "stores the file" --> uploads

  queue --> handler
  queue --> ingestion
  queue --> reconciler

  handler -- "reads rows" --> postgres
  handler -- "rebuilds keys" --> readmodel
  ingestion -- "reads its chunk" --> uploads
  ingestion -- "upserts products" --> postgres
  ingestion -- "product.upserted" --> queue
  reconciler -- "boundaries, drift" --> postgres
  reconciler -- "repairs" --> readmodel
  reconciler -- "readmodel.rebuild" --> queue

  prometheus -- "scrapes /metrics" --> application
  grafana --> prometheus

  classDef actor fill:#fff,stroke:#888,stroke-dasharray:3 3
```

The four queues are one per urgency class, so a 500 000-row import cannot delay a flash sale
([ADR-0003](./ADR.md)). `event-handler` and `reconciler` both write the read model: the first on
the events a write produces, the second on a five-minute sweep that repairs what the queue lost
([ADR-0006](./ADR.md)). Prometheus scrapes all four containers - the API on `3100`, each worker on
its own `3101` ([docs/operations.md](./docs/operations.md)).

## What the case study asks to be submitted

| Deliverable                           | Where it is                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The database schema DDL**           | [`docs/schema.sql`](./docs/schema.sql) - the whole schema as one file, taken with `pg_dump` from a database created empty and migrated forward. The migrations that produce it are [`src/shared/db/migrations/`](./src/shared/db/migrations), and they are the input; the file is a copy kept for a reader who wants to open one thing. |
| **The architectural decisions (ADR)** | [ADR.md](./ADR.md) - twelve records, each with what was decided, the trade-offs it carries and what was rejected. Scenario A is [ADR-0005](./ADR.md), Scenario B is [ADR-0006](./ADR.md).                                                                                                                                               |
| **The AI usage appendix (Form 5)**    | [Form 5 - AI Appendix](<./Form 5_AI Appendix.docx>), with the working notes it is written from in [`docs/ai-appendix-notes.md`](./docs/ai-appendix-notes.md) - what each AI mistake was, how it was caught, and what the fix changed.                                                                                                   |
| The code                              | this repository; the map is [below](#repository-map).                                                                                                                                                                                                                                                                                   |

The two scenarios are the part the case study says it weighs most, so they are also the part with
measurements rather than claims: a 500 000-row import on the 256 MiB container it is constrained
to, and a category-wide flash sale under read load, both in
[docs/e2e-evidence/](./docs/e2e-evidence) with the vantage point of every number.

## Start here

```bash
cp .env.example .env    # placeholders only; .env is gitignored
npm run up              # stores, api, three workers, test stores, monitoring
DATABASE_URL=postgres://promo:promo@localhost:5432/promotion npm run seed
```

`npm run up` is the whole boot: `api` migrates before it listens, so the command returns only once
the schema is current and the application is answering. The seed fills PostgreSQL with 1 000
products and one seven-day flash sale.

| Where                              | What                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| http://127.0.0.1:3100/api          | the API                                                             |
| http://127.0.0.1:3100/admin/queues | Bull Board: the four queues, the dead-letter set, retry and discard |
| http://localhost:9090/alerts       | Prometheus and the seven alert rules                                |
| http://localhost:3001              | Grafana, no login                                                   |

> [!NOTE]
> The storefront answers `503` until a worker has built the read model, and the seed does not build
> it - only a worker does. That is the design, not a fault: [ADR-0006](./ADR.md).

Then:

```bash
curl -s http://127.0.0.1:3100/api/ready
curl -X POST http://127.0.0.1:3100/api/vendor/imports -F vendor=acme -F file=@fixtures/vendor-sample.csv
curl -s http://127.0.0.1:3100/api/vendor/imports/1
```

The first says whether PostgreSQL and Redis are reachable and names which is not; the second
answers `202 {"jobId":1,"chunksTotal":1}`; the third follows the import until `status` reads
`completed`.

`npm run down` stops everything and keeps the data. The detail - profiles, ports, configuration,
the workers, what to do when a port is taken - is in [docs/running-locally.md](./docs/running-locally.md).

## What the case study asked for, and where it is answered

| The ask                                                                 | Where it lives                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Product listing, filtering, sorting by effective price                  | `GET /api/products` - [docs/api.md](./docs/api.md)                                                       |
| Create, assign and cancel promotions; one applied promotion per product | `/api/promotions*`, enforced by two GiST exclusion constraints - [ADR-0004](./ADR.md)                    |
| Dynamic pricing rules an operator can change without a deploy           | the `pricing_rules` table - [docs/data-model.md](./docs/data-model.md)                                   |
| Scenario A: a 500 000-row vendor file on 256 MiB and half a CPU         | `POST /api/vendor/imports` - [ADR-0005](./ADR.md), measured in [docs/e2e-evidence/](./docs/e2e-evidence) |
| Scenario B: a category-wide flash sale under read load                  | the Redis read model - [ADR-0006](./ADR.md), measured in [docs/e2e-evidence/](./docs/e2e-evidence)       |
| Operating it: health, metrics, alerts, a dead-letter set                | [docs/operations.md](./docs/operations.md)                                                               |

The user journeys these were built from are in [docs/e2e-cases/](./docs/e2e-cases), written from
the case study rather than from the code; the runs that exercised them, with their numbers and the
vantage point each number was taken from, are in [docs/e2e-evidence/](./docs/e2e-evidence).

## Endpoints

| Method | Path                         | Description                                                                                                             | Statuses                          |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| GET    | `/api/health`                | Liveness probe, returns `{"status":"ok"}`                                                                               | `200`                             |
| GET    | `/api/ready`                 | Readiness probe: asks PostgreSQL and Redis and names which one is unreachable                                           | `200`, `503`                      |
| GET    | `/api/products`              | Storefront listing, `{ items, page, pageSize, total }`                                                                  | `200`, `400`, `503`               |
| GET    | `/api/products/:id`          | One product with its applied promotion                                                                                  | `200`, `404`, `503`               |
| POST   | `/api/products`              | Create a product (`sku`, `name`, `category`, `basePriceCents`, `stockQuantity`); emits `product.upserted`               | `201`, `409`                      |
| POST   | `/api/vendor/imports`        | Register a vendor file (multipart `file`, field `vendor`); answers `{ jobId, chunksTotal }` and queues a job per chunk  | `202`, `400`, `409`, `413`, `415` |
| GET    | `/api/vendor/imports/:id`    | Follow an import: `status`, `chunksTotal`, `chunksDone`, `rowsProcessed`, `rowsRejected`, `lastError`                   | `200`, `404`                      |
| POST   | `/api/promotions`            | Create a promotion; with `productId` or `category` it is born `active`, with neither it is a `draft`                    | `201`, `404`, `409`               |
| POST   | `/api/promotions/:id/assign` | Give a draft its one target (`productId` **or** `category`) and make it `active`                                        | `200`, `404`, `409`               |
| POST   | `/api/promotions/:id/cancel` | Cancel a promotion and drop its scheduled boundaries; idempotent, so a second call also answers `200`                   | `200`, `404`                      |
| GET    | `/api/promotions`            | List promotions, filtered and paged (`status`, `category`, `productId`, `limit`, `after`); returns `{ "items": [...] }` | `200`                             |
| GET    | `/api/promotions/:id`        | One promotion                                                                                                           | `200`, `404`                      |

Query parameters, the error envelope, validation and the `status` / `state` distinction are in
[docs/api.md](./docs/api.md).

[`docs/postman/ModaCo.postman_collection.json`](./docs/postman/ModaCo.postman_collection.json)
is a Postman collection for every endpoint in the table above, with assertions rather than bare
requests. Import it, bring the stack up with `npm run up`, and run the folders in order: **1
Health**, **2 Storefront**, **3 Promotions**, **4 Vendor import**, **5 Refusals** — every request
in that last folder is expected to fail, and a 2xx there is the finding. `baseUrl` defaults to
`http://127.0.0.1:3100/api`; the upload request needs a file picked by hand, for which
`fixtures/vendor-sample.csv` is the one to choose. Propagation is asynchronous, so a storefront
assertion run immediately after a write may need a second attempt: that is the design rather than
a flaky test.

## Tests

```bash
npm ci
npm test                  # the unit layer, no database needed
npm run test:integration  # needs the test stores npm run up already started
npm run lint
```

Coverage is 100 % on all four thresholds and enforced by the required `ci` check. The integration
layer runs against a real PostgreSQL and a real Redis, never a mock. Layers, environment variables
and the schema-drift check are in [docs/testing.md](./docs/testing.md).

## Repository map

| Path           | What is in it                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/modules/` | one directory per module, each with `domain/`, `db/`, `http/`, `commands/`, `queries/`, `events/` ([ADR-0008](./ADR.md)) |
| `src/workers/` | the three worker entry points: `event-handler`, `ingestion-worker`, `reconciler`                                         |
| `src/shared/`  | database client, queue, config, logging, metrics                                                                         |
| `tests/`       | `unit/` and `integration/`, each mirroring `src/`                                                                        |
| `monitoring/`  | Prometheus scrape config and the alert rules                                                                             |
| `docs/`        | everything below                                                                                                         |

## Documentation

| Document                                             | What it answers                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [ADR.md](./ADR.md)                                   | every architectural decision, with its trade-offs and what was rejected |
| [docs/running-locally.md](./docs/running-locally.md) | the stack, configuration, the queue, demo data, troubleshooting         |
| [docs/api.md](./docs/api.md)                         | endpoint semantics, query parameters, errors, validation                |
| [docs/data-model.md](./docs/data-model.md)           | tables, migrations, the pricing rules, the read model's keys            |
| [docs/operations.md](./docs/operations.md)           | Bull Board, `/metrics`, the alert rules, clearing a failed set          |
| [docs/testing.md](./docs/testing.md)                 | the test layers and what each one needs                                 |
| [docs/e2e-cases/](./docs/e2e-cases)                  | the user journeys, written from the case study                          |
| [docs/e2e-evidence/](./docs/e2e-evidence)            | what the runs measured, with each number's vantage point                |
| [Form 5 - AI Appendix](<./Form 5_AI Appendix.docx>)  | how AI was used building this, the mistakes it made and who caught them |
| [REVIEW.md](./REVIEW.md)                             | the review rulebook every change is held to                             |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                 | source layout, naming, the pull request process                         |

## Stack

Node.js 22, Express 5, TypeScript strict, zod, pino, PostgreSQL 16 with Drizzle, Redis 7 with
BullMQ and ioredis, json-rules-engine for the pricing rules, Vitest and Supertest, prom-client
with Prometheus and Grafana. Why each, and what was rejected, is in [ADR.md](./ADR.md).

Every change lands through a pull request with `ci` and `claude-review` green and TDD from the
first commit; [CONTRIBUTING.md](./CONTRIBUTING.md) has the process.
