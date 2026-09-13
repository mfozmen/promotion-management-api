# ModaCo — Promotion Management API

[![CI](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mfozmen/promotion-management-api/actions/workflows/ci.yml) [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_promotion-management-api&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_promotion-management-api)

A REST API for managing products and time-bound promotions for ModaCo, an e-commerce platform. It supports listing and filtering products with category-aware, paginated, effective-price-sorted queries, and creating, cancelling and assigning percentage or fixed-value promotions to a product or an entire category, enforcing at most one applied promotion per product.

## Tech stack

- Node.js 22
- Express 5
- TypeScript (strict mode)
- zod (request and event-payload validation)
- pino + pino-http (structured JSON logging)
- http-errors (the error envelope: status, `expose`, response headers)
- PostgreSQL 16 write store, Drizzle ORM + drizzle-kit SQL migrations
- BullMQ on Redis 7 (event queue; see [ADR-0003](./ADR.md))
- ioredis (the storefront read model, on its own Redis database; see [ADR-0006](./ADR.md))
- json-rules-engine (the ingestion pricing rules, read from the database)
- Vitest + Supertest (testing)
- ESLint + Prettier
- SonarCloud (static analysis / quality gate)
- GitHub Actions (CI)
- Claude AI advisory review on pull requests

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16, Redis 7, and the `api` image built from this repository's `Dockerfile`, which also runs the three worker services, all run locally from `docker-compose.yml`), plus one throwaway Redis on 6399 for the queue integration tests, which use no mocks (REVIEW.md 7.3)

## Run it

Docker with the Compose plugin, and Node for the two npm scripts below.

```bash
cp .env.example .env   # placeholders only; .env is gitignored
npm run up             # PostgreSQL, Redis, the api, three workers and the test stores
```

The API is on http://127.0.0.1:3100 and BullMQ's dashboard on
http://127.0.0.1:3100/admin/queues. `npm run down` stops everything and keeps the data; add `-v` to that compose command to
drop the volumes too. PostgreSQL creates its database on first start only, so a test store
that predates a change to `POSTGRES_DB` needs `docker compose --profile test rm -sfv
postgres-test` rather than a restart.

`event-handler`, `ingestion-worker` and `reconciler` run from the same image as `api`, one
command each. Each waits on all three of `postgres`, `redis` and `api` being healthy; the gate
that matters is `api`, the only process that migrates, because waiting on the stores alone would
let a worker connect before the schema exists.

**They start, connect and wait — none of them consumes anything yet.** Each logs that it holds a
producer handle on every queue and that no consumer is registered, so an idle queue is not
mistaken for a drained one; no worker holds a subset of the queues. On `docker compose stop` each
closes the queue within `SHUTDOWN_DRAIN_TIMEOUT_MS` (10 s) and exits anyway if it has not closed
by then. `api` is given the same budget but spends it on its HTTP drain and then closes the queue
and the pool with no bound of their own, so on `api` the grace period is a ceiling rather than a
bound: exit 137 with no `shutdown complete` line means it hung there. Every service is given
`stop_grace_period: 15s` so a worker's bound can be reached and logged: Docker's default grace is
also 10 s, which would kill the process at the same moment as the warning explaining why the stop
is slow (ADR-0003). The projection arrives with issue #12, the chunk processor
with #105, and the reconciler's boundary sweep with #18, in its own pull request under
`src/workers/reconciler/`. They carry no healthcheck for the same reason: until a worker has
work, a check could only confirm the process is alive, which `up --wait` already does. All three
run under `restart: unless-stopped`, like every other service here — a worker that exits is
restarted, one you stop by hand stays stopped.

`ingestion-worker` is capped at 256 MiB and half a CPU, which is the case study's own
constraint rather than a setting: Scenario A's claim is that a 500 000-row import survives that
cap, and the measurement is taken against it. It also runs with
`NODE_OPTIONS=--max-old-space-size=192`, because V8 otherwise picks a heap ceiling _above_ the
container limit (`docker run -m 256m node:22-alpine` reports 259 MB) and the cap would arrive as
an unexplained `SIGKILL` instead of a heap error the import can catch; move one number and move
the other.

`api` and `ingestion-worker` share a named `uploads` volume mounted at `/app/uploads`: `api`
writes the uploaded file there and the worker reads it back by `file_ref`, so the two have to be
on the same host. Both services set `UPLOAD_DIR=/app/uploads` explicitly, and the image creates
that directory and gives it to the `node` user before dropping privileges: a named volume takes
its ownership from the image, so without that the mountpoint is root-owned and the first upload
fails with `EACCES` on a volume that looks correctly mounted (ADR-0003). Nothing writes to it yet
— the upload endpoint and chunk worker arrive with issue #16.
`tests/unit/docs/compose-workers.test.ts` parses the compose file and the `Dockerfile`, and fails
if the cap, the heap ceiling under it, the grace period, the shared mount or its ownership goes
missing.

## Develop

```bash
npm ci
npm test              # the unit layer, no database needed
npm run test:integration
npm run lint
```

That one command is the whole boot. `api` migrates before it listens, so `--wait` returns only once the schema is current and the application is answering on http://127.0.0.1:3100 — there are no tables, constraints, the `active_promotions` view or seeded `ingestion` pricing rules to install by hand, and no `DATABASE_URL` to get right: the service composes it from the same `POSTGRES_*` variables `postgres` reads. Every `up` is safe, because Drizzle's migrations table applies only what it has not already recorded.

It is one verb rather than two because a one-shot migration service cannot be waited on: `--wait` means "running, or healthy where a healthcheck exists", and a one-shot is neither for long, so it reports green over a migration still installing and red over one that finished. A long-lived service with a healthcheck has no such gap — the check cannot answer in front of a missing schema. ADR-0003 holds the measurements.

For a database that is not the compose one, `npm run db:migrate` applies the same migrations from the host against whatever `DATABASE_URL` names (`drizzle.config.ts` reads it from the environment, not from `.env`). `npm run dev` needs no such step: it runs the same `src/server.ts` the image does, so it migrates its `DATABASE_URL` before it listens. There is no ingestion command yet; the upload endpoint and chunk worker arrive with issue #16.

Demo data. Once the schema is up, one more command fills it:

```bash
DATABASE_URL=postgres://promo:promo@localhost:5432/promotion npm run seed
```

It applies [`scripts/demo-seed.sql`](./scripts/demo-seed.sql) as a single transaction: 1 000 products over `Electronics`, `Apparel`, `Home` and `Sports`, and one seven-day 20 % flash sale on `Electronics`. It fills PostgreSQL and nothing else: no worker builds the Redis read model, so a seeded stack still answers `503` on both product routes (ADR-0006). It is a script rather than a migration because a production database must be able to skip it; the `ingestion` pricing rules a vendor import applies are reference data, not demo data, and are seeded by migration `0001_seed_pricing_rules.sql`.

Run it as often as you like: what you get depends on the migrations and this run alone, never on what a previous run left. Products upsert on `sku` and rewrite only a row whose values or provenance differ from what this run would leave, so a row an import had claimed goes back to being a demo row, provenance columns and all. The flash sale is deleted by name and re-inserted rather than updated, because the `promotions_no_overlapping_active_category` exclusion constraint would reject a second active row over the same category and window; its window opens at the moment of the run, so re-running is also how a demo database left for more than a week gets a live sale back.

Two seeds at once are safe. They serialise on the product rows — `ON CONFLICT DO UPDATE` takes the row lock before it evaluates its guard — and whichever commits second deletes the first's sale by name before writing its own, so you still get one catalogue and one sale. What the seed will not do is replace a promotion it does not own: an active `Electronics` promotion under another name is not deleted by name, so the insert aborts on `23P01` and the whole file rolls back, leaving no half-written catalogue behind.

[`fixtures/vendor-sample.csv`](./fixtures/vendor-sample.csv) is the matching vendor file, in the contract of the design spec's section 7 (`sku,name,category,vendor_price,stock_quantity`): rows above and below the bulk-discount stock threshold, an `Electronics` row for the markup, and a quoted field containing a comma. Nothing consumes it yet: the `ingestion-worker` container runs but registers no consumer, and the upload endpoint and chunk worker arrive with issue #16.

Tests and checks. The queue and shutdown integration tests obliterate the queues they use, so they run against their own Redis rather than the compose one — `npm run up` starts it, along with the throwaway PostgreSQL the integration layer clones from. Both are in the `test` profile and hold nothing worth keeping.

```bash
npm test
npm run test:cov # needs a PostgreSQL and that Redis, see below
npm run lint
```

`npm run dev` starts the API on `PORT` (default `3100`); `GET http://localhost:3100/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file.

The suite is split into layers, so the one that needs nothing can run anywhere:

| Layer                              | Command                    | Needs                                                                                                            | Runs                        |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- |
| unit (`tests/unit/`)               | `npm test`                 | nothing                                                                                                          | pre-commit hook, everywhere |
| integration (`tests/integration/`) | `npm run test:integration` | PostgreSQL, the compose Redis (database 9) and, for the queue and shutdown tests only, a throwaway Redis on 6399 | CI, before every push       |
| both, with coverage                | `npm run test:cov`         | the same two                                                                                                     | CI (the 100 % gate)         |

The integration tests run against a real PostgreSQL and a real Redis, never a mock. Point them at one with
`TEST_DATABASE_URL` (default `postgres://postgres:postgres@127.0.0.1:55432/promotion`). That
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

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data`, `redis-data` and `uploads` volumes as well. An `e2e-tester` run never touches this stack: it puts `-p pma-e2e` on every compose command so its own volumes are the only ones it drops, and it stops rather than starting if you are holding 3100, 5432 or 6379.

### Configuration

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — and `src/server.ts` calls it before it migrates or listens, so a bad value stops the boot rather than the first request. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432, 6379 and 3100 on `127.0.0.1`; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL`, `REDIS_URL` or `PORT` to match. `PORT` defaults to 3100 in both `src/shared/config.ts` and `.env.example`, and the compose healthcheck and published port name 3100 literally, so changing it for the container means changing all three together. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores, the `api` service built from this repository's `Dockerfile`, the three worker services (`event-handler`, `ingestion-worker`, `reconciler`) running that same image with one command each, and a browser for each store behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. `api` publishes http://127.0.0.1:3100 and migrates before it serves, so `docker compose up -d --wait` returns only once the schema is current and the application is answering — there is no migration command to run and no `migrate` service any more. The port is 3100 rather than 3000 because 3000 is what every other Node service on a developer's machine takes. The workers have no healthcheck and no consumer yet, so `--wait` treats them as up once they are running. The `monitoring` profile is not built: issue #18 adds it.

### The queue

Four queues, one per urgency class, and `eventRouting` maps an event to one of
them — the caller never picks. `promotions` carries `promotion.changed` and the
delayed boundary jobs, `products` carries `product.upserted`, `ingestion` carries
`chunk.process`, and `maintenance` carries `readmodel.rebuild` and
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

Directories are named for a role and a file holds one exported declaration named after it (REVIEW.md 8c.2, 8c.7, ADR-0008). The tree and the naming rules are in [CONTRIBUTING.md](./CONTRIBUTING.md) under "Source layout"; this file does not repeat them. Nothing sits at the `tests/` root: a helper belongs to the layer that uses it, named `<subject>-<role>.ts`, as `tests/unit/capture-logger.ts` is (REVIEW.md 7.7).

Inside a layer the tree mirrors `src/`, one test file per source file. Every test file now imports its subject through the `@src/*` alias (`tsconfig.json` `paths` + `vitest.workspace.ts`, which declares the alias once and spreads it into both projects — a workspace project does not inherit the root `vitest.config.ts` `resolve` block, so an alias declared only there fails every aliased import at load time); production code under `src/` uses relative specifiers and never the alias, because `tsc` does not rewrite path aliases on emit — an ESLint rule enforces that boundary ([CONTRIBUTING.md](./CONTRIBUTING.md)).

## Database schema

The DDL is the migration set in [`src/shared/db/migrations/`](./src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the five enums, the six tables, the two GiST exclusion constraints that enforce one active promotion per product and per category, the `pricing_rules_set_updated_at` trigger with its function, and the single `reconciler_state` row; `0001_seed_pricing_rules.sql` seeds the three `type = 'ingestion'` pricing rules (the promotion-precedence rules are a separate set and arrive with the resolver, ADR-0004), `0002_active_promotions.sql` creates the `active_promotions` view, and `0003_promotion_list_indexes.sql` adds the two `(product_id, id)` and `(category, id)` btree indexes the admin promotion list filters and orders on — the GiST exclusion indexes cannot serve it, being partial on `status = 'active'`. Each table's Drizzle mirror lives in the module that owns it, under `db/schema/`, one file per table and per enum; `reconciler_state` sits under `src/workers/reconciler/db/schema/`. There is no barrel re-exporting them. Four of the objects above have no expression in it — the extension, the two exclusion constraints, the trigger with its function, and the seed row — so `npm run db:generate` would drop them; CI's "No schema drift" step does not catch that direction — a committed regeneration leaves a clean tree — so the integration tests, which assert each of the four directly, are what notices (ADR-0003). The view is not a fifth: drizzle-kit generated `0002` and its snapshot from `promotion/db/schema/active-promotions.ts`, and `npm run db:generate` reports no changes on a clean tree.

`active_promotions` is the one answer to which clock decides whether a promotion is running: `status = 'active' and tstzrange(starts_at, ends_at) @> now()`, evaluated by PostgreSQL, never re-derived in application code. The resolver selects from it instead of restating the predicate (ADR-0004). The admin reads do not: `GET /api/promotions` and `GET /api/promotions/:id` have to show drafts, scheduled and expired promotions too, which the view by definition does not hold, so they project a five-valued `state` from the same half-open window in SQL (one `sql` fragment in `src/modules/promotion/db/promotion-repository.ts`). The range is half-open: a promotion is live the instant `starts_at` arrives and stops the instant `ends_at` does. `tests/integration/shared/db/active-promotions.test.ts` pins that boundary — it inserts and reads inside one transaction, where `now()` is `transaction_timestamp()` and therefore constant, so an inclusive upper bound fails the test instead of passing it unnoticed. It is not an endpoint; no route exposes it.

`tests/integration/` and the module folders under `src/modules/` are named in the design spec and land with the endpoints that need them. The Redis read model has no DDL of its own, so nothing under `migrations/` describes it. Nothing writes it yet either: no worker consumes the `promotions` queue, so on a fresh stack `readmodel:ready` is absent and both product routes answer `503` until the recompute story lands (ADR-0006).

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

All endpoints are mounted under the `/api` prefix (ADR-0009). Request bodies are JSON, capped at 100 kB, and validated strictly: an unknown field is a `400`, never a silently dropped one. The Statuses column lists what a route decides for itself; `400`, `413` and `415` come from the shared boundary and can answer any of them.

| Method | Path                         | Description                                                                                                             | Statuses            |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| GET    | `/api/health`                | Liveness probe, returns `{"status":"ok"}`                                                                               | `200`               |
| GET    | `/api/products`              | Storefront listing, `{ items, page, pageSize, total }`                                                                  | `200`, `400`, `503` |
| GET    | `/api/products/:id`          | One product with its applied promotion                                                                                  | `200`, `404`, `503` |
| POST   | `/api/products`              | Create a product (`sku`, `name`, `category`, `basePriceCents`, `stockQuantity`); emits `product.upserted`               | `201`, `409`        |
| POST   | `/api/promotions`            | Create a promotion; with `productId` or `category` it is born `active`, with neither it is a `draft`                    | `201`, `404`, `409` |
| POST   | `/api/promotions/:id/assign` | Give a draft its one target (`productId` **or** `category`) and make it `active`                                        | `200`, `404`, `409` |
| POST   | `/api/promotions/:id/cancel` | Cancel a promotion and drop its scheduled boundaries; idempotent, so a second call also answers `200`                   | `200`, `404`        |
| GET    | `/api/promotions`            | List promotions, filtered and paged (`status`, `category`, `productId`, `limit`, `after`); returns `{ "items": [...] }` | `200`               |
| GET    | `/api/promotions/:id`        | One promotion                                                                                                           | `200`, `404`        |

**Operations.** After `npm run up`, BullMQ's own dashboard is at
http://localhost:3100/admin/queues — the four queues with their counts, the dead-letter set
(`removeOnFail: false` keeps every exhausted job in BullMQ's failed set) and the controls to
retry, promote or remove a job. It is Bull Board mounted inside the api process, outside the
`/api` prefix and outside this API's error envelope, and like everything else here it is
unauthenticated.

`GET /api/products` takes `category` (exact match, optional, 256 characters), `sort=effectivePrice` (the only sort), `order=asc|desc` (default `asc`), `page` (default 1) and `pageSize` (1-100, default 20); the resulting offset may not exceed 10 000. `GET /api/products/:id` takes an id of digits only.

`GET /api/promotions` takes five optional query parameters, combined with `AND`. Three are filters: `status` (`draft`, `active` or `cancelled`), `category` (exact match) and `productId`. Two page the result: `limit` (a positive integer, default `50`, maximum `100`) and `after`, a keyset cursor holding the last `id` of the previous page. The list is ordered by `id` and the response is `{ "items": [...] }` with no cursor of its own — the caller reads the last id it received, and a page shorter than `limit` is the end. Keyset rather than `OFFSET`, because `id` never changes, so a promotion created mid-read cannot make a page repeat or skip a row. There is no sort parameter: the storefront listing that needs one is a separate endpoint. Filtering on the derived `state` is deliberately absent: that is a predicate on `now()`, and time predicates are PostgreSQL's.

Every promotion response carries both `status`, the value an admin set (`draft`, `active`, `cancelled`), and `state`, what the promotion is doing right now (`draft`, `scheduled`, `live`, `expired`, `cancelled`). `state` is computed by PostgreSQL in every read and in every write's `returning` clause (one `sql` fragment in `src/modules/promotion/db/promotion-repository.ts`), never derived in TypeScript, so no Node clock can drift against it (ADR-0004).

The overlap `409` is raised from SQLSTATE `23P01` — the two GiST exclusion constraints on `promotions` firing — and names no promotion: the envelope carries a message and nothing else. An admin refused one finds the blocker with `GET /api/promotions` filtered by `productId` or `category`.

An id that is not a positive integer answers `400`, the same as the storefront's: it is a malformed request rather than a promotion that does not exist. A `productId` no product owns answers `404`.

### Conventions

- **Errors.** Every failure returns `{ "error": { "message": "..." } }`, and the status is what a client branches on. A 4xx carries the message its raiser wrote; a 5xx carries `Internal server error` unless the raiser marked it readable, which is `http-errors`' own `expose` rather than a rule of ours (ADR-0009).
- **An unexpected error** — anything the `http-errors` library does not recognise — answers `500` with `Internal server error` and nothing else; the stack goes to the log under `err` and never to the response (ADR-0010).
- **Validation.** Request bodies, query strings and path parameters are validated at the boundary with strict zod schemas: an unknown field is a `400`, not a silently ignored typo. The rejection names the failing part and nothing more (`Invalid request body`): no field path, no issue list, no echo of what you sent. Strictness is top-level; a nested object declares its own with `z.strictObject(...)` (ADR-0009).
- **Request bodies** are capped at 100kb. Everything body-parser refuses keeps the status that says which failure it was — 400 for a body that cannot be read, 413 for one over the cap, 415 for a charset it will not decode. The 413 and 415 carry body-parser's own message, which describes the caller's own request; the 400 for unparsable JSON does not — it answers `Invalid JSON body`, because body-parser's message quotes the offending bytes and the parser's position back at the caller. The quoted detail goes to the log under `reason` (ADR-0009).
- **Storefront reads.** Both product routes are served from the Redis read model and never from PostgreSQL, so they answer `503` with a `Retry-After` in two cases: until a rebuild has published `readmodel:ready`, and whenever Redis is unreachable. A product the detail route cannot find is a `404`; a rebuild is required never to leave a listed product without its entry, so the route does not spend a command per miss asking. `page` and `pageSize` are bounded together: the resulting offset may not exceed 10 000.
- **Correlation id.** Send `x-request-id` (matching `^[A-Za-z0-9._-]{1,128}$`) to trace a request; anything else is replaced by a generated uuid. The id used is returned in the `x-request-id` response header and appears as `reqId` on every JSON log line (ADR-0010).

## Development workflow

- **TDD**: every change starts with a failing test (red-green-refactor).
- **Conventional Commits** for all commit messages.
- All changes land through pull requests — no direct pushes to `main`.
- A PR merges only once the required checks `ci` and `claude-review` are green. `ci` runs the SonarCloud scan and waits for its quality gate; the scan is skipped on a PR that touches nothing SonarCloud reads, which is why SonarCloud's own check is not required. Every SonarCloud finding on the PR is fixed before hand-off (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- `local-gates` runs on every PR and computes which local-agent labels apply; it does not block the merge, but its labels are read at hand-off. When the checks are green, the threads are resolved and the labels are on, the PR is labelled `needs-human-check` and the owner is mentioned; merge happens only after the owner's approving comment, as a squash.
- Every review (AI or human) enforces [REVIEW.md](./REVIEW.md); blocking findings are fixed before the owner is asked to check, and a Warning is fixed in the pull request that found it rather than filed as an issue.

See [ADR.md](./ADR.md) for architectural decisions, [Form 5 — AI Appendix](./Form%205_AI%20Appendix.docx) for AI usage documentation, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
