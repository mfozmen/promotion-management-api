# Running it locally

Everything here runs from `docker-compose.yml`. The short version is in the [README](../README.md); this file is the detail.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with the Compose plugin (PostgreSQL 16, Redis 7, and the `api` image built from this repository's `Dockerfile`, which also runs the three worker services, all run locally from `docker-compose.yml`), plus the `test` profile's two throwaway stores — PostgreSQL on 55432 and Redis on 6399 — for the integration tests, which use no mocks (REVIEW.md 7.3)

## The stack

Docker with the Compose plugin, and Node for the two npm scripts below.

```bash
cp .env.example .env   # placeholders only; .env is gitignored
npm run up             # the stores, the api, three workers, the test stores and monitoring
```

Grafana is on http://localhost:3001, no login, with Prometheus scraping the api and each worker
every five seconds. The dashboard is the community **NodeJS Application Dashboard**
([grafana.com id 11159](https://grafana.com/grafana/dashboards/11159)) rather than one of ours;
pick the process in the `instance` list. During a 500 000-row import, the panel to watch is the
`ingestion-worker` instance's heap and resident memory against the 256 MiB the container is
limited to — the heap is what `--max-old-space-size=192` bounds and the resident figure is what
the cgroup kills on.

The API is on http://127.0.0.1:3100 and BullMQ's dashboard on
http://127.0.0.1:3100/admin/queues. `npm run down` stops everything and keeps the data; add `-v` to that compose command to
drop the volumes too.

If `npm run up` stops with `postgres-test` unhealthy, that is the expected failure for a test
store older than the last change to `POSTGRES_DB`: PostgreSQL creates the database only when it
initialises its volume, and the healthcheck queries the database by name, so a store holding the
old name never reports healthy instead of handing the suite a server without it. The fix is
`docker compose --profile test rm -sfv postgres-test`, which drops the volume; a restart keeps it
and changes nothing (ADR-0003).

Three worker services run from the same image as `api`, one command each, and each waits on
`postgres`, `redis` and `api` being healthy — `api` is the gate that matters, being the only
process that migrates.

- `reconciler` **consumes `reconciler.run` on the `maintenance` queue** and registers the
  repeatable that publishes it every five minutes, so the promotion boundary sweep runs on a fresh
  stack with nothing to start by hand.
- `event-handler` rebuilds the read model on boot and then drains `promotions` and `products`
  for it.
- `ingestion-worker` drains `ingestion` for the chunk processor, one chunk at a time. It is
  capped at 256 MiB and half a CPU — the case study's own constraint, and what Scenario A's
  500 000-row import is measured against — and runs with `NODE_OPTIONS=--max-old-space-size=192`
  so V8's heap ceiling sits under that cap. One containerised run at those limits processed all
  500 000 rows in 6 of 6 chunks with none rejected, peaking at 49.9 MiB of the 256 by container
  accounting, and a V8 heap flat across chunks (25 MB falling to 18 MB) — flat being the property
  rather than the peak, since nothing accumulates as the file is consumed. The reasoning and the
  host-side figures are in ADR-0005. That run predates the read-model consumer, so it measures
  the importer alone; a later run through `POST /api/vendor/imports` with the consumer draining
  its announcements took **128 s** and peaked at 54.9 MiB, and the difference between the two is
  the system keeping its read model current rather than anything about the importer. No duration
  here means anything without saying which of the two it is. Both scenarios are measured end to
  end in [`docs/e2e-evidence/`](../docs/e2e-evidence).

Each start-up line carries a `consuming` list — `maintenance`, `ingestion`, and `products` with
`promotions` — and the port that worker serves `/metrics` on. None of the three has a healthcheck,
so `--wait` treats them as up once they are running; Prometheus reporting the target `down` is the
nearest thing to one (ADR-0011).

`api` and `ingestion-worker` bind-mount `./uploads` at `/app/uploads`, because whoever registers a
file writes it there and the worker reads it back by `file_ref` — a name inside that directory
rather than a path, so the two processes agree on where it is across a container boundary. A named
volume would not have done: the host's `./uploads`, which `npm run ingest` writes to, would have
been a different directory that looked identical in this file. Both `npm run ingest -- <file>`
and `POST /api/vendor/imports` write there.

`docker compose stop` gives those four services — `api` and the three workers, the ones that close
a queue — `stop_grace_period: 15s` for a shutdown budgeted at `SHUTDOWN_DRAIN_TIMEOUT_MS` (10 s),
one deadline over the whole sequence, after which the process exits anyway.

Why each of those is what it is — the grace period against the drain budget, the heap ceiling under
the memory cap, the volume's ownership, `unless-stopped` rather than `always` — is in ADR-0003.
`tests/unit/docs/compose-workers.test.ts` parses the compose file and the `Dockerfile` and fails if
any of them goes missing.

## Boot order and migrations

That one command is the whole boot. `api` migrates before it listens, so `--wait` returns only once the schema is current and the application is answering on http://127.0.0.1:3100 — there are no tables, constraints, the `active_promotions` view or seeded `ingestion` pricing rules to install by hand, and no `DATABASE_URL` to get right: the service composes it from the same `POSTGRES_*` variables `postgres` reads. Every `up` is safe, because Drizzle's migrations table applies only what it has not already recorded.

It is one verb rather than two because a one-shot migration service cannot be waited on: `--wait` means "running, or healthy where a healthcheck exists", and a one-shot is neither for long, so it reports green over a migration still installing and red over one that finished. A long-lived service with a healthcheck has no such gap — the check cannot answer in front of a missing schema. ADR-0003 holds the measurements.

For a database that is not the compose one, `npm run db:migrate` applies the same migrations from the host against whatever `DATABASE_URL` names (`drizzle.config.ts` reads it from the environment, not from `.env`). `npm run dev` needs no such step: it runs the same `src/server.ts` the image does, so it migrates its `DATABASE_URL` before it listens. Against a running stack the same registration goes over HTTP, which is the only door a
Docker-only reader has:

## Demo data

Demo data. Once the schema is up, one more command fills it:

```bash
npm run seed
```

It applies [`scripts/demo-seed.sql`](../scripts/demo-seed.sql) as a single transaction: 1 000 products over `Electronics`, `Apparel`, `Home` and `Sports`, and one seven-day 20 % flash sale on `Electronics`. It fills PostgreSQL and nothing else: no worker builds the Redis read model, so a seeded stack still answers `503` on both product routes (ADR-0006). It is a script rather than a migration because a production database must be able to skip it; the `ingestion` pricing rules a vendor import applies are reference data, not demo data, and are seeded by migration `0001_seed_pricing_rules.sql`.

Run it as often as you like: what you get depends on the migrations and this run alone, never on what a previous run left. Products upsert on `sku` and rewrite only a row whose values or provenance differ from what this run would leave, so a row an import had claimed goes back to being a demo row, provenance columns and all. The flash sale is deleted by name and re-inserted rather than updated, because the `promotions_no_overlapping_active_category` exclusion constraint would reject a second active row over the same category and window; its window opens at the moment of the run, so re-running is also how a demo database left for more than a week gets a live sale back.

Two seeds at once are safe. They serialise on the product rows — `ON CONFLICT DO UPDATE` takes the row lock before it evaluates its guard — and whichever commits second deletes the first's sale by name before writing its own, so you still get one catalogue and one sale. What the seed will not do is replace a promotion it does not own: an active `Electronics` promotion under another name is not deleted by name, so the insert aborts on `23P01` and the whole file rolls back, leaving no half-written catalogue behind.

[`fixtures/vendor-sample.csv`](../fixtures/vendor-sample.csv) is the matching vendor file, in the contract of the design spec's section 7 (`sku,name,category,vendor_price,stock_quantity`): rows above and below the bulk-discount stock threshold, an `Electronics` row for the markup, and a quoted field containing a comma. `npm run ingest -- fixtures/vendor-sample.csv` registers it and the `ingestion-worker` drains it; `curl -F vendor=acme -F file=@fixtures/vendor-sample.csv` sends the same file over the wire.

## Vendor files

`npm run ingest -- <file> [vendor]` registers a vendor file: it copies the file into `UPLOAD_DIR`,
stores the job and one chunk row per byte range, and enqueues a `chunk.process` job for each, which
the `ingestion-worker` drains. `npm run generate:vendor -- --rows 500000` writes a file to register.
`POST /api/vendor/imports` does the same registration over HTTP, for a file that is not already
on the machine running the command.

a flaky test.

## Stopping it

Stop the stack with `docker compose down`, or `docker compose down -v` to drop the `postgres-data`, `redis-data`, `prometheus-data` and `grafana-data` volumes as well — `./uploads` is a bind mount on the host and survives either way. An `e2e-tester` run never touches this stack: it puts `-p pma-e2e` on every compose command so its own volumes are the only ones it drops, and it stops rather than starting if you are holding 3100, 5432 or 6379.

### Configuration

`.env.example` lists every variable the application reads; copy it to `.env` and adjust. `src/shared/config.ts` parses them with zod — a missing or malformed value throws naming the offending variable — and `src/server.ts` calls it before it migrates or listens, so a bad value stops the boot rather than the first request. Redis runs one server with two logical databases: `REDIS_READ_MODEL_DB` (default `0`) for the storefront read model and `REDIS_QUEUE_DB` (default `1`) for the BullMQ queues; they must differ. The ports `docker-compose.yml` publishes are fixed at 5432, 6379 and 3100 on `127.0.0.1`, plus 9090 and 3001 for Prometheus and Grafana under the `monitoring` profile; if one is taken on your machine, change the published port in the compose file and `DATABASE_URL`, `REDIS_URL` or `PORT` to match. `WORKER_METRICS_PORT` (default `3101`) is where each worker serves `/metrics`; it is published nowhere and is reachable on the compose network alone, so all three workers share the one number. `PORT` defaults to 3100 in both `src/shared/config.ts` and `.env.example`, and the compose healthcheck and published port name 3100 literally, so changing it for the container means changing all three together. Changing `POSTGRES_PASSWORD` against an existing `postgres-data` volume does not change the password PostgreSQL already has: the stack still reports healthy and the application fails at its first connect, so recreate the volume with `docker compose down -v` (ADR-0003).

The compose file holds the two stores, the `api` service built from this repository's `Dockerfile`, the three worker services (`event-handler`, `ingestion-worker`, `reconciler`) running that same image with one command each, and a browser for each store behind the `tools` profile: `docker compose --profile tools up -d` adds Adminer at http://127.0.0.1:8081 (server `postgres`, user `promo`) and redis-commander at http://127.0.0.1:8082; a plain `docker compose up` does not start them. `api` publishes http://127.0.0.1:3100 and migrates before it serves, so `docker compose up -d --wait` returns only once the schema is current and the application is answering — there is no migration command to run and no `migrate` service any more. The port is 3100 rather than 3000 because 3000 is what every other Node service on a developer's machine takes. The workers have no healthcheck, so `--wait` treats them as up once they are running, whether or not they consume. The `monitoring` profile adds Prometheus at http://127.0.0.1:9090 and Grafana at http://127.0.0.1:3001, and `npm run up` starts it; `docker compose up -d` without the profile leaves both out and changes nothing else.

### The queue

Four queues, one per urgency class, and `eventRouting` maps an event to one of
them — the caller never picks. `promotions` carries `promotion.changed` and the
delayed boundary jobs, `products` carries `product.upserted`, `ingestion` carries
`chunk.process`, and `maintenance` carries `readmodel.rebuild` and
`reconciler.run`. The partition is what keeps a 500 000-row import's ~500
announcements, or a full read-model rebuild, from sitting in front of a flash
sale's `promotion.changed`: each queue gets its own worker, so two events that
need different priority get different consumers rather than a priority number
inside one queue (ADR-0003). All four have consumers: `src/workers/reconciler.ts`
takes `reconciler.run` and `readmodel.rebuild` off `maintenance` through
`MaintenanceDispatcher`, `src/workers/ingestion-worker.ts` drains `ingestion`, and
`src/workers/event-handler.ts` drains `promotions` and `products` after rebuilding
the read model on boot. A job whose name the dispatcher has no arm for still fails
into the dead-letter set rather than being acknowledged by a process that ignored
it.

BullMQ uses the logical database `REDIS_QUEUE_DB` names, while `REDIS_READ_MODEL_DB`
holds the read model, so queue maintenance and read-model rebuilds cannot destroy
each other (ADR-0007). `src/server.ts` reads both from `src/shared/config.ts` and
passes the queue one to `EventQueue.connect`, which is what makes the configuration
check that they differ mean something.

`npm run dev` opens the queue connections at startup against `REDIS_URL`, which
has no default and is required (`.env.example` sets the compose one), but it
starts and serves without a Redis
there: connection errors are logged and every publish fails at its 2 s bound
rather than hanging. Connecting has its own 10 s budget. `SIGTERM` closes the HTTP
server first, the pool next and the queues last, and `SHUTDOWN_DRAIN_TIMEOUT_MS`
(default 10 s; digits only, so a blank value is rejected rather than read as the
`0` that exits immediately) is one deadline over that whole sequence, not one per
step: whatever has not finished by then is abandoned and the process exits
(ADR-0003). Every process in the image stops the same way.
