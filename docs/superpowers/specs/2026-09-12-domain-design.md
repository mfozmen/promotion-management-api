# Domain Design — ModaCo Promotion Management API

Date: 2026-09-12. Status: approved by the owner; decisions recorded as
ADR-0003 to ADR-0007. This spec unifies the owner's CQRS architecture with the
corrections found in review (see `docs/ai-appendix-notes.md`, 2026-09-12 design
phase).

## 1. Architecture in one paragraph

CQRS on a modular monolith. PostgreSQL 16 is the write store and the only
source of truth. Redis 7 holds the read model the storefront queries (sorted
sets for price-ordered listings, hashes for product detail) and never falls
back to PostgreSQL. BullMQ (Redis-backed) is the event bus: every write emits
a job, the event-handler worker recomputes the affected read-model entries
from PostgreSQL, the ingestion worker processes vendor-file chunks under
serverless-shaped limits, and a reconciler repairs drift. One codebase, one
Docker image, four commands (`api`, `event-handler`, `ingestion-worker`,
`reconciler`).

## 2. Storage and money

- PostgreSQL 16, Drizzle ORM, `drizzle-kit` SQL migrations under
  `src/shared/db/migrations/` (the DDL deliverable). Extension `btree_gist`.
- Redis 7. Logical DB `0` = read model, DB `1` = BullMQ. Rebuilds never
  `FLUSH`; they `SCAN` + `UNLINK` by prefix.
- Money is integer minor units (`*_cents bigint`); percentages are basis
  points (`10000 = 100 %`). No floats in pricing. Drizzle bigint columns use
  `mode: 'number'` (values stay far below 2^53).
- All timestamps `timestamptz`, compared in UTC. Ranges are half-open `[)`.

## 3. Schema (write store)

```sql
create extension if not exists btree_gist;

create table products (
  id                     bigint generated always as identity primary key,
  sku                    text not null unique,
  name                   text not null,
  category               text not null,
  base_price_cents       bigint not null check (base_price_cents >= 0),
  stock_quantity         integer not null check (stock_quantity >= 0),
  pricing_rules_version  integer,                -- set by ingestion, null for manual creates
  ingest_source_offset   bigint,                 -- byte offset of the vendor row that last wrote this product
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index products_category_id_idx on products (category, id);   -- keyset scans per category

create type discount_type    as enum ('percentage', 'fixed');
create type promotion_status as enum ('draft', 'active', 'cancelled');

create table promotions (
  id             bigint generated always as identity primary key,
  name           text not null,
  discount_type  discount_type not null,
  value          bigint not null check (value > 0),              -- basis points or cents
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  product_id     bigint references products (id),
  category       text,
  status         promotion_status not null,                    -- 'draft' until assigned, then 'active'
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  check (ends_at > starts_at),
  check (discount_type <> 'percentage' or value <= 10000),
  check (status <> 'active' or (product_id is null) <> (category is null)), -- active = exactly one target
  check (status <> 'draft' or (product_id is null and category is null)),  -- draft = no target
  -- cancelled keeps whatever shape it had (a cancelled draft has no target)
  -- At most one active product-level promotion per product per instant.
  exclude using gist (product_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status = 'active' and product_id is not null),
  -- At most one active category-level promotion per category per instant.
  exclude using gist (category with =, tstzrange(starts_at, ends_at) with &&)
    where (status = 'active' and category is not null)
);
-- The two GiST exclusion indexes also serve point lookups
-- (target = $1 and tstzrange(starts_at, ends_at) @> now()).

create table pricing_rules (                    -- ingestion rules only (json-rules-engine)
  id          bigint generated always as identity primary key,
  name        text not null,
  conditions  jsonb not null,
  event       jsonb not null,
  priority    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create type ingestion_status as enum ('running', 'paused', 'completed', 'failed', 'aborted');

create table ingestion_jobs (
  id               bigint generated always as identity primary key,
  vendor           text not null,
  file_ref         text not null,                 -- path under UPLOAD_DIR (blob key in production)
  file_sha256      text not null unique,          -- same file twice = 409, never a second job
  file_size_bytes  bigint not null,
  chunks_total     integer not null,
  chunks_done      integer not null default 0,
  rows_processed   bigint not null default 0,
  rows_rejected    bigint not null default 0,
  status           ingestion_status not null default 'running',
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index ingestion_jobs_one_running_per_vendor
  on ingestion_jobs (vendor) where status in ('running', 'paused');

create table reconciler_state (             -- one row; watermark for the promotion boundary sweep
  id                      boolean primary key default true check (id),
  last_boundary_sweep_at  timestamptz not null default now()
);

create type chunk_status as enum ('pending', 'running', 'done', 'failed');

create table ingestion_chunks (
  job_id          bigint not null references ingestion_jobs (id),
  chunk_index     integer not null,
  start_offset    bigint not null,                -- byte offset of first line, inclusive
  end_offset      bigint not null,                -- byte offset after last newline, exclusive
  next_offset     bigint not null,                -- durable checkpoint, starts at start_offset
  lease_until     timestamptz,                    -- claim expiry; expired = re-claimable
  attempts        integer not null default 0,    -- claims, including planned budget hand-offs
  failures        integer not null default 0,    -- claims that ended in an error; drives the terminal 'failed' state
  rows_processed  integer not null default 0,
  rows_rejected   integer not null default 0,
  status          chunk_status not null default 'pending',
  last_error      text,
  primary key (job_id, chunk_index)
);
```

## 4. Promotion resolution and effective price

- **Active** = `status = 'active' and starts_at <= now() < ends_at`.
- **Applied promotion** for a product: its active product-level promotion if
  one exists, else the active category-level promotion for its category, else
  none. The exclusion constraints guarantee at most one candidate per level,
  so resolution is deterministic and race-free.
- The rule the case calls "at most one active promotion per product" is
  implemented as **at most one applied promotion**. A product-level and a
  category-level promotion may both exist; the product-level one wins even
  when the category discount is larger. Consequence, stated to admins: a
  "50 % off Accessories" sale skips accessories that carry their own
  promotion.
- Same-level overlap (two active product promotions on one product, or two on
  one category, overlapping in time) is rejected with `409` by the constraint
  (SQLSTATE 23P01). The handler then selects the overlapping promotion to
  report `{ conflictingPromotionId }`. No silent override: cancel first.
- Effective price, one pure function `applyPromotion(baseCents, promotion)` in
  `src/modules/pricing/effective-price.ts`, used by the event handler, the
  reconciler and tests:
  - percentage: `base - floor(base * value / 10000)`
  - fixed: `max(base - value, 0)`
- Validation on create: `endsAt > startsAt`, `endsAt > now()` (a promotion
  that is already over is a `400`); `startsAt` in the past is allowed and
  means "now".
- Create, assign and cancel are the three mutations (decision K1, owner):
  - `POST /api/promotions` with `productId` or `category` creates the
    promotion already assigned and `active`, atomically. Without a target it
    creates a `draft`: no target, never applied, invisible to the read model.
  - `POST /api/promotions/:id/assign` with exactly one of `productId` or
    `category` moves a `draft` to `active` and sets the target in one
    guarded `UPDATE`:
    ```sql
    update promotions set status = 'active', product_id = $2, category = $3
    where id = $1 and status = 'draft' and ends_at > now() returning *;
    ```
    Zero rows → `409` (not a draft, a concurrent assign won, or the draft's
    window has already ended; the handler reads the row back to say which).
    The `ends_at > now()` guard mirrors the create-time check: a draft that
    sat unassigned past its own window cannot be activated dead. The
    exclusion constraints run inside the same statement, so overlap is a
    `409` exactly as on create. Two concurrent assigns of one draft yield one
    `200` and one `409` with no application-side locking.
  - `POST /api/promotions/:id/cancel` sets `status = 'cancelled'`,
    `cancelled_at = now()`; cancelling a draft is allowed. Nothing is deleted.
- Category is free text, trimmed at the boundary and matched exactly
  (case-sensitive), because a categories table is out of scope. A category
  promotion is not rejected when no product carries that category yet:
  Scenario B requires products ingested later to inherit it. Instead the
  create and assign responses include `productCount` (a `count(*)` on the
  category at that instant) so a typo shows up as `0` in the admin's face, and
  the API logs a warning at `productCount = 0`.
- Storefront responses carry `basePriceCents`, `effectivePriceCents` and
  `promotion: { id, name } | null` so any price can be explained.
- Promotion responses carry a derived `state`: `draft`, `scheduled` (before
  `startsAt`), `live`, `expired` (after `endsAt`) or `cancelled`. `status`
  stays a three-value column; time is never written back into the row.
- `GET /api/promotions` and `GET /api/promotions/:id` read PostgreSQL
  (admin path, decision K2): filters `status`, `category`, `productId`.

Resolution query (used by the event handler and reconciler, batched by id):

```sql
select p.*, pp.id as pp_id, pp.name as pp_name, pp.discount_type as pp_type, pp.value as pp_value,
             cp.id as cp_id, cp.name as cp_name, cp.discount_type as cp_type, cp.value as cp_value
from products p
left join promotions pp on pp.product_id = p.id and pp.status = 'active'
                       and tstzrange(pp.starts_at, pp.ends_at) @> now()
left join promotions cp on cp.category = p.category and cp.status = 'active'
                       and tstzrange(cp.starts_at, cp.ends_at) @> now()
where p.id = any($1);
```

## 5. Read model (Redis DB 0)

| Key                   | Type | Content                                                                                                                                   |
| --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `product:{id}`        | HASH | `id, sku, name, category, basePriceCents, effectivePriceCents, stockQuantity, promotionId, promotionName, pricingRulesVersion, updatedAt` |
| `category:{category}` | ZSET | score = `effectivePriceCents`, member = product id                                                                                        |
| `products:all`        | ZSET | same, across all categories (listing without a category filter)                                                                           |
| `readmodel:ready`     | STR  | present once a full rebuild has completed; storefront routes answer `503` until then                                                      |

- `GET /api/products/:id` = `HGETALL product:{id}` (zero PostgreSQL reads).
- `GET /api/products` = `ZRANGE <zset> -inf +inf BYSCORE LIMIT offset size`
  ascending, `ZRANGE <zset> +inf -inf BYSCORE REV LIMIT offset size`
  descending (with `REV` Redis expects the maximum first) → pipeline `HGETALL` per id; `total` = `ZCARD`.
  Members with equal scores order by member string, which is deterministic
  but not numeric (`"10"` before `"9"`); zero-pad ids if numeric tie order
  ever matters.
- Writing a product entry is one `MULTI`: `HSET product:{id}`,
  `ZADD category:{new}`, `ZADD products:all`, and `ZREM category:{old}` when
  the stored category differs. Bulk recomputes pipeline 1 000 entries per
  round trip.
- Every read-model write is a **recompute from PostgreSQL** (section 4
  query), never a delta applied to Redis. Handlers are therefore idempotent
  and safe to retry; ordering between handlers is enforced by running
  exactly one event-handler instance with `concurrency: 1` (the compose file
  does not scale this service).
- Redis unreachable: storefront routes answer `503`; admin writes still
  commit to PostgreSQL, their enqueue fails and is logged, and the reconciler
  repairs the read model once Redis is back.
  The handler runs as a single serialised instance; per-category locks are
  the upgrade if one instance cannot keep up with write volume.

## 6. Events (BullMQ, Redis DB 1)

Two queues. Defaults for every job: `attempts: 3`, exponential backoff from
1 s, `removeOnComplete: 1000`, `removeOnFail: false` (the failed set is the
dead-letter queue, visible in Bull Board and the admin endpoints).

| Queue       | Job name            | Payload                              | Producer                                                                    | Handler effect                                                                                                        |
| ----------- | ------------------- | ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `events`    | `product.upserted`  | `{ productIds: number[] }` (≤ 1 000) | `POST /api/products` (one id); ingestion batch                              | recompute those products, write read model                                                                            |
| `events`    | `promotion.changed` | `{ promotionId }`                    | create (with a target), assign, cancel, delayed activate/expire, reconciler | product target: recompute 1; category target: keyset-scan the category by id in batches of 1 000, recompute, pipeline |
| `events`    | `readmodel.rebuild` | `{ category?: string }`              | cold start, admin, reconciler                                               | `SCAN`+`UNLINK` the scope, stream products from PostgreSQL, rebuild; full rebuild sets `readmodel:ready`              |
| `events`    | `reconcile.run`     | `{}` (repeatable, every 5 min)       | reconciler worker schedule                                                  | see section 9                                                                                                         |
| `ingestion` | `ingestion.chunk`   | `{ jobId, chunkIndex }`              | import registration, resume, time-budget hand-off                           | process the chunk from its checkpoint (section 7)                                                                     |

Scheduling of promotion boundaries happens when a promotion first becomes
`active`, which is either create-with-target or `assign`; a draft schedules
nothing because it has no target. At that moment enqueue `promotion.changed`
immediately (if `startsAt` has passed) or delayed until `startsAt` with
`jobId = promo:{id}:activate`, and always a delayed job until `endsAt` with
`jobId = promo:{id}:expire`. Cancel removes both by job id and enqueues an
immediate `promotion.changed`. Delayed jobs persist in Redis across restarts;
the reconciler's boundary sweep covers a lost one.

Emission happens after the PostgreSQL commit. A crash between commit and
enqueue leaves the read model stale until the reconciler repairs it; this is
accepted instead of a transactional outbox.

## 7. Scenario A: vendor file ingestion

Design goal: 500 000 rows pass through the ingestion rules and land in
PostgreSQL through many short, stateless, memory-bounded units of work, each
resumable from a durable checkpoint, so a kill at any instant loses at most
one batch and never duplicates rows.

**Register** (`POST /api/vendor/imports`, multipart, API container):

1. Stream the upload to `UPLOAD_DIR/{uuid}.csv` while hashing (`sha256`) and
   counting bytes. Nothing is buffered beyond the stream's high-water mark.
   In production this step is a direct-to-blob upload plus a blob-created
   trigger that runs steps 2-4; locally the API does it in one request.
2. Reject with `409` if `file_sha256` already exists (returns the existing job
   id) or if the vendor has a `running`/`paused` job. Reject with `429` when
   the `ingestion` queue's waiting count exceeds `INGESTION_MAX_WAITING`
   (backpressure).
3. Compute chunk boundaries with one streaming pass: target `CHUNK_BYTES`
   (default 4 MiB, ≈ 40 000 rows), each boundary moved forward to the next
   `0x0A`. Chunk 0 starts after the header line (and a UTF-8 BOM, if any).
   Insert the job and its chunk rows in one transaction.
4. Enqueue one `ingestion.chunk` job per chunk and answer
   `202 { jobId, chunksTotal }`. Duplicate jobs for a chunk are harmless: the
   lease makes every extra invocation return immediately.

**Process** (`processChunk(jobId, chunkIndex, budgetMs)`, ingestion worker;
this function is the serverless unit — locally hosted by a BullMQ worker with
`256 MiB` / `0.5 CPU` limits, in production by a queue-triggered function):

1. **Claim with a lease**:
   ```sql
   update ingestion_chunks set status = 'running', attempts = attempts + 1,
          lease_until = now() + $lease
   where job_id = $1 and chunk_index = $2
     and (status = 'pending' or (status = 'running' and lease_until < now()))
     and exists (select 1 from ingestion_jobs j where j.id = $1 and j.status = 'running')
   returning *;
   ```
   Zero rows and the chunk is `done`/`failed`: return. Zero rows and the
   chunk is `running` with a live lease: another worker holds it; re-enqueue
   this job delayed by the remaining lease and return. The job-status check
   is inside the same `UPDATE`, so a pause or abort can never race a claim;
   a chunk of a `paused`/`aborted` job simply claims zero rows and returns.
2. **Read** `fs.createReadStream(file, { start: next_offset, end: end_offset - 1 })`
   (ranged GET in production). Split raw `Buffer`s on `0x0A`, carry the
   partial tail, strip a trailing `0x0D`. Offsets advance by byte length. A
   line never contains a split code point because `0x0A` cannot occur inside
   a UTF-8 multi-byte sequence, so `line.toString('utf8')` is safe. File
   contract (decision K3): header
   `sku,name,category,vendor_price,stock_quantity`; `vendor_price` is a
   decimal with at most two fraction places (`799.90`) parsed to integer
   cents without floating point (`"799.90"` → `79990`), more places or a
   non-numeric value rejects the row. The zod row schema mirrors every
   database constraint so a bad row can never abort a batch: `sku`, `name`
   and `category` are non-empty trimmed strings, `vendor_price` is `>= 0`,
   `stock_quantity` is a non-negative integer, and the price produced by the
   ingestion rules is checked `>= 0` before the batch is built (a rule that
   drives a price negative rejects the row and logs the rule name). A
   constraint violation that still escapes is a defect: the batch fails with
   the offending rows logged and counts against `failures`; UTF-8, optional BOM, LF or CRLF; RFC
   4180 quoting within a line is supported, embedded newlines are not. A
   sample lives at `fixtures/vendor-sample.csv`.
3. **Batch** 1 000 lines: parse, validate (zod), **dedupe by SKU in a `Map`
   (last row wins) and sort by `sku`** (a consistent lock order, so
   concurrent batches on overlapping SKUs cannot deadlock), run each row through the ingestion rules
   (`json-rules-engine`, rules loaded from `pricing_rules` and cached for
   60 s), producing `base_price_cents` and `pricing_rules_version`. Invalid
   rows are counted as rejected and logged with their byte offset; they never
   abort the batch.
4. **Commit** one transaction: multi-row
   `insert ... on conflict (sku) do update` plus the checkpoint as a
   compare-and-set:
   ```sql
   update ingestion_chunks
   set next_offset = $new, rows_processed = rows_processed + $n,
       rows_rejected = rows_rejected + $r, lease_until = now() + $lease
   where job_id = $1 and chunk_index = $2 and next_offset = $seen;
   ```
   Zero rows updated → the lease was lost to another worker: roll back and
   return. Otherwise commit, then enqueue `product.upserted` with the batch's
   ids.
5. **Budget**: after each batch, if `elapsed > budgetMs` (default 60 s),
   **release** the chunk (`set status = 'pending', lease_until = null where
... and next_offset = $seen`), enqueue a fresh `ingestion.chunk` job for it
   and return. The checkpoint is already durable, so the next invocation
   resumes at `next_offset`. A crash between release and enqueue leaves a
   `pending` chunk without a job; the reconciler's orphan sweep (section 9)
   re-enqueues it. A planned release does not touch `failures`; only a
   caught error does (`set failures = failures + 1, last_error = $e,
status = 'pending', lease_until = null`), so a slow chunk may hand off
   any number of times without approaching the failure limit. `lockDuration` on the BullMQ worker is `budgetMs + 30 s`, so a
   healthy run is never marked stalled; a dead worker's job is re-queued by
   stalled detection and re-claimed once the lease expires.
6. **Finish**: when `next_offset = end_offset`, mark the chunk `done` and
   increment `chunks_done`; the job becomes `completed` when
   `chunks_done = chunks_total`. A chunk whose `failures` reaches
   `INGESTION_MAX_FAILURES` (default 3) is `failed` with `last_error`; the job
   is `failed` once every chunk is terminal. `attempts` is informational.

Memory: one batch of parsed rows plus the stream buffers. No whole-file reads,
no `Promise.all` across the file, no per-row events. Parallelism: chunks are
independent, `--scale ingestion-worker=N` processes N chunks concurrently;
rows for the same SKU in different chunks resolve by **file position, not
commit order**: `products.ingest_source_offset` stores the byte offset of the
row that last wrote the product, and the upsert carries
`where excluded.ingest_source_offset > products.ingest_source_offset`. The
later row in the file therefore wins no matter which worker commits first, so
`--scale ingestion-worker=N` is safe. Rows from an older file cannot clobber a
newer one either, because a new job resets the column through the same
comparison against its own offsets.

## 8. Scenario B: flash sales

Design goal: creating a category promotion is one row and one event; the
storefront never touches PostgreSQL; a product added mid-sale is discounted
on its first read; expiry and scheduled starts happen on time.

1. `POST /api/promotions { category: "Accessories", percentage 5000, ... }`
   → one `INSERT` (exclusion constraint checked) → `promotion.changed` job.
2. Event handler scans the category by keyset (`where category = $1 and id > $last order by id limit 1000`), recomputes each product with the section 4 query, and pipelines the read-model writes. 50 000 products take a few seconds; during that window pages mix old and new prices. The listing is consistent once the scan completes.
   Writes are progressive by design; building `category:{c}:new` and switching with `RENAME` is the upgrade if the mixed window ever matters.
3. Storefront reads are pure Redis: `ZRANGE ... BYSCORE` for listings, `HGETALL` for detail. PostgreSQL load during the sale is the handler's scan only.
4. New product in the category: `POST /api/products` → `product.upserted` → recompute finds the active category promotion → discounted entry written before the product is visible at all (a product exists in the storefront only once its hash exists).
5. Cancel: `status = 'cancelled'` → delayed jobs removed → immediate `promotion.changed` → category rescanned → base prices restored.
6. Scheduled start/end: the delayed `activate`/`expire` jobs fire at the boundary; the read model changes within the handler's scan time, not on a cache TTL.

Base-price changes during a sale (vendor ingestion, the only update channel) go through
`product.upserted` and pick up the active promotion in the recompute.

## 9. Safety net

Automatic:

- **Retry + backoff + DLQ**: 3 attempts, exponential backoff, failed set kept as the dead-letter queue.
- **Stalled recovery**: BullMQ stalled detection with `lockDuration` sized to the time budget; a crashed worker's job is re-run and the lease lets the next worker claim it.
- **Checkpoint resume**: the compare-and-set `next_offset` means a retry continues, never restarts, and two workers cannot both advance one chunk.
- **Backpressure**: `429` on new imports above `INGESTION_MAX_WAITING`.
- **Category-scoped reconciler** (`reconcile.run`, every 5 min): per category compare `ZCARD` with `count(*)`, recompute a random sample of 50 products and compare with the hashes, and sweep promotions whose `starts_at`/`ends_at` fell between the previous successful sweep and now (the watermark lives in `reconciler_state.last_boundary_sweep_at`, a one-row table, written only after the sweep succeeds, so a long outage is caught up on the first run back; re-emitting `promotion.changed` is idempotent). A mismatch enqueues `readmodel.rebuild { category }`, never a full rebuild. The same run performs the **ingestion orphan sweep**: for every job in `running`, chunks that are `pending`, or `running` with an expired lease, get a fresh `ingestion.chunk` job (idempotent thanks to the claim).
- **Cold start**: the API enqueues `readmodel.rebuild {}` when `readmodel:ready` is missing and answers `503` on storefront routes until it exists.
- **Worker self-protection**: a worker that sees `process.memoryUsage().heapUsed` above `WORKER_HEAP_LIMIT` finishes its current batch (checkpointed), stops taking jobs and exits; Docker `restart: always` brings it back.
- **Handler isolation**: every handler catches, logs with the job id and rethrows so BullMQ records the failure; nothing crashes the process.

Manual (all under `/api/admin`, plus Bull Board at `/admin/queues`):

| Endpoint                                                  | Effect                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/admin/queues/stats`                             | per queue: waiting, active, delayed, failed, oldest waiting job age |
| `POST /api/admin/queues/:name/pause` / `resume`           | stop or restart consumption during a backlog                        |
| `POST /api/admin/queues/:name/drain?confirm=true`         | drop waiting jobs                                                   |
| `POST /api/admin/dlq/retry` / `discard` (`?queue=`)       | re-queue or delete failed jobs                                      |
| `POST /api/vendor/imports/:id/pause` / `resume` / `abort` | control one file; resume re-enqueues its pending chunks             |
| `POST /api/admin/read-model/rebuild?category=`            | scoped or full rebuild via `SCAN`+`UNLINK`                          |

Alarms (monitoring stack, compose profile `monitoring`): the API and every
worker expose `GET /metrics` with `prom-client` (default Node metrics plus
`queue_waiting`, `queue_failed`, `queue_oldest_job_age_seconds`,
`readmodel_drift_products`, `http_request_duration_seconds`,
`ingestion_rows_processed_total`, `ingestion_chunks_stuck`). Prometheus
scrapes them; Grafana ships with a provisioned dashboard and alert rules:
queue depth > 10 000, any failed (DLQ) job, drift > 1 %, API p95 > 500 ms,
5xx rate > 1 %, worker RSS > 90 % of its limit, stuck ingestion chunk,
health down. Alerts fire and resolve in Grafana's Alerting view; that is the
alarm simulation for the case. Notification channels are Grafana
configuration, not application code.

## 10. API

All routes under `/api`; JSON errors `{ error: { code, message, details? } }`;
zod validation at every boundary; OpenAPI generated from the zod schemas and
served at `/api/docs` (Swagger UI) and `/api/openapi.json` (issue #2).

| Method | Path                                           | Store    | Notes                                                                                                                 |
| ------ | ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/products`                                | Redis    | `category?`, `sort=effectivePrice`, `order=asc\|desc`, `page`, `pageSize` (≤ 100); `{ items, page, pageSize, total }` |
| GET    | `/api/products/:id`                            | Redis    | hottest endpoint; `404` if the hash is missing                                                                        |
| POST   | `/api/products`                                | PG+event | `sku, name, category, basePriceCents, stockQuantity`; `409` on duplicate SKU                                          |
| POST   | `/api/promotions`                              | PG+event | `name, discountType, value, startsAt, endsAt, productId? \| category?`; no target = `draft`; `409` on overlap         |
| POST   | `/api/promotions/:id/assign`                   | PG+event | `productId \| category`; draft → active; `409` on overlap, non-draft, or an `endsAt` already passed                   |
| POST   | `/api/promotions/:id/cancel`                   | PG+event | idempotent                                                                                                            |
| GET    | `/api/promotions`, `/api/promotions/:id`       | PG       | `status?`, `category?`, `productId?`                                                                                  |
| POST   | `/api/vendor/imports`                          | PG+queue | multipart `file`, field `vendor`; `202`                                                                               |
| GET    | `/api/vendor/imports/:id`                      | PG       | progress, chunk statuses, `last_error`, stuck chunks (`running` with expired lease)                                   |
| POST   | `/api/vendor/imports/:id/pause\|resume\|abort` | PG+queue |                                                                                                                       |
| GET    | `/api/health`                                  | —        | PostgreSQL, Redis, queue reachability; `readmodel:ready`                                                              |
| *      | `/api/admin/...`                               | —        | section 9                                                                                                             |

## 11. Layout

```
src/
  app.ts, server.ts                      Express wiring / API entry point
  modules/
    product/     product.routes.ts, product.service.ts, product.repository.ts, product.schemas.ts, read-model.ts
    promotion/   promotion.routes.ts, promotion.service.ts, promotion.repository.ts, promotion.schemas.ts, scheduling.ts
    pricing/     effective-price.ts (pure), ingestion-rules.ts (json-rules-engine wrapper), resolve-products.ts (section 4 query)
    vendor/      vendor.routes.ts, import.service.ts (register/chunk), chunk-processor.ts (processChunk), csv-lines.ts (byte splitter), schemas
    admin/       admin.routes.ts, queues.service.ts, read-model-rebuild.ts, health.ts
  workers/       events.ts, ingest.ts, reconcile.ts   (thin entry points: create worker, register handler, start)
  shared/        config.ts, db.ts (Drizzle + migrations), redis.ts, queue.ts (BullMQ queues), logger.ts (pino, request ids)
tests/
  unit/          effective-price, csv-lines, ingestion-rules, schemas
  integration/   routes + handlers against real PostgreSQL and Redis (docker compose), concurrency, ingestion kill/resume
docker-compose.yml   postgres, redis, api, event-handler, ingestion-worker (256M / 0.5 CPU), reconciler; profile "monitoring": prometheus, grafana (provisioned dashboard + alert rules); profile "tools": pgadmin, redis-commander
Dockerfile           one image, command per service
```

## 12. Testing

- Edge cases that must have a named test: cancel an unassigned draft (no
  target, allowed by the CHECKs), assign a non-draft (`409`), assign with
  both or neither target (`400`), a vendor row with a negative price or stock
  rejected without aborting its batch, a category promotion whose category matches
  no product (`201` with `productCount: 0` and a warning log), assigning a draft whose `endsAt` has passed
  (`409`), two concurrent assigns of one draft (one `200`, one `409`), a
  product created in a category with an active promotion is discounted on its
  first read, a budget release leaving `failures` untouched while an
  error increments it, and a reconciler catch-up after an outage longer than
  its period (watermark sweep re-emits the missed boundary).
- Unit: pure functions and schemas (effective price, precedence, CSV byte
  splitting across chunk boundaries with BOM/CRLF/UTF-8, rule application).
- Integration: real PostgreSQL and Redis from `docker compose`, database
  `promotion_test`, migrations in Vitest `globalSetup`, tables truncated per
  file. Handlers are invoked directly (no worker process) so coverage is
  measured.
- Concurrency: parallel promotion creates on one target assert exactly one
  `201` and the rest `409`; parallel `processChunk` calls on one chunk assert
  a single writer.
- Ingestion: a generated 500 000-row fixture (`scripts/generate-vendor-csv.ts`),
  a run with a 2 s budget (forces many hand-offs), a `SIGKILL` of the worker
  child process mid-chunk and a restart; assert exact row count, no
  duplicates, `rows_processed` equals distinct SKUs, peak RSS under 256 MiB
  (also exercised by the `e2e-tester` agent).
- Flash sale: create a category promotion over 50 000 seeded products, assert
  listing order and detail prices after the handler completes, then add a
  product to the category and assert the discount on first read.
- Coverage 100 %; exclusions are `src/server.ts` and `src/workers/*.ts`
  only.

## 13. Out of scope

Authentication, multi-currency, promotion
stacking, product update and deletion (decision K4: the vendor feed is the
only channel that changes product data after creation), a categories table (text column is enough),
pre-signed direct-to-blob uploads (documented as the production path), atomic
listing swap during a category recompute, per-category handler parallelism.
`pgadmin` and `redis-commander` ship only under the `tools` compose profile.
