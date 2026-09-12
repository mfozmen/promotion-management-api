# Architecture Decision Records

This document records the significant architectural decisions made for the ModaCo Promotion Management API. Each ADR captures the context that prompted the decision, the decision itself, and its consequences and trade-offs, so future contributors understand not just what was decided but why.

---

## ADR-0001: Node.js, Express and TypeScript

**Status:** Accepted — mandated by the case study

### Context

The case study specifies the implementation stack: Node.js, Express, and TypeScript. No alternative runtime or framework evaluation is required or expected.

### Decision

Build the API on Node.js 22 (current LTS-track version), using Express 5 as the HTTP framework, with TypeScript in strict mode for all source code.

### Consequences

- Express 5 brings native support for async route handlers (unhandled rejections are forwarded to error middleware automatically), simplifying error handling compared to Express 4.
- TypeScript strict mode catches null/undefined and type-mismatch bugs at compile time, at the cost of more upfront type annotation work.
- The ecosystem (middleware, testing tools, ORMs) for Node/Express/TypeScript is mature and well-documented, reducing integration risk.
- Because the stack is mandated rather than chosen, there is no trade-off analysis against alternatives (e.g. Fastify, NestJS) — that discussion is out of scope.

---

## ADR-0002: Test-driven development with Vitest

**Status:** Accepted

### Context

The case study requires a TDD workflow. A test runner and assertion/mocking toolkit compatible with TypeScript and Express (via Supertest for HTTP-level tests) is needed, with fast feedback loops given the red-green-refactor cycle will run continuously during development.

### Decision

Use Vitest as the test runner, paired with Supertest for HTTP integration tests against the Express app. Every feature and bug fix starts with a failing test written before the implementation.

### Consequences

- Vitest's native TypeScript/ESM support avoids extra transpilation configuration and its watch mode gives sub-second feedback, which is important for a strict red-green-refactor cycle.
- Supertest lets integration tests exercise the Express app in-process (no network binding required), keeping the hottest endpoints (e.g. single product detail) testable at both unit and HTTP-contract level.
- Coverage reporting (`npm run test:cov`) feeds the SonarCloud quality gate.
- TDD discipline slows down initial feature authoring in exchange for a regression-resistant codebase and living documentation of behavior via tests — this is treated as a net win for a codebase reviewed by AI and humans on every PR.

---

## ADR-0003: PostgreSQL write store, Redis read model, BullMQ event bus (CQRS)

**Status:** Accepted — see `docs/superpowers/specs/2026-09-12-domain-design.md`

### Context

Two workloads pull in opposite directions: the storefront reads (`GET /products`, `GET /products/:id`) must survive flash-sale traffic, while admin writes and weekly bulk ingestion must remain transactional and race-free. A single relational store serving both would put the hottest endpoint in the system behind the same connection pool as 500 000-row imports.

### Decision

CQRS on a modular monolith. PostgreSQL 16 is the write store and the only source of truth, accessed through Drizzle ORM with SQL migrations (which double as the DDL deliverable). Redis 7 holds the read model the storefront queries: a hash per product and price-ordered sorted sets per category and for all products. BullMQ, running on a separate Redis logical database, carries events from writes to the event-handler worker, which recomputes affected read-model entries from PostgreSQL. One Docker image runs four commands: `api`, `event-handler`, `ingestion-worker`, `reconciler`.

Money is stored as integer minor units, percentages as basis points, timestamps as `timestamptz`.

### Consequences

- Storefront reads never touch PostgreSQL; their cost is one or two Redis round trips regardless of promotion activity.
- Every read-model write is a recompute from PostgreSQL, so handlers are idempotent and retry-safe; the event-handler runs with concurrency 1 to keep them ordered.
- The read model is eventually consistent: a write is visible after the handler runs, typically well under a second for single products and a few seconds for a 50 000-product category.
- Redis is a hard runtime dependency; an empty read model answers `503` until the cold-start rebuild completes.
- "Emission after commit" is enforced at runtime, not only by convention: `src/shared/queue.ts` marks a transaction body with an `AsyncLocalStorage` scope (`withinTransaction`) and `enqueue()` throws when called inside one, so the ordering mistake fails loudly in a test instead of surfacing as a rare stale read (REVIEW.md 3.4; issue #7, branch `feat/queue-contracts`, based on PR #27).

### Trade-offs

- Eventual consistency instead of read-your-writes on the storefront. Accepted because the storefront is a catalogue, not a checkout.
- Two stores and a queue to operate instead of one database. Accepted because the case grades the structural answer to flash-sale load, and the safety net (ADR-0007) covers drift.
- Emission after commit without a transactional outbox: a crash between commit and enqueue leaves stale entries until the reconciler repairs them within five minutes.

### Rejected alternatives

- Single PostgreSQL with computed effective price and a versioned Redis cache: simpler, but the sort by effective price cannot use an index and every cache miss during a flash sale is a top-N sort over the category; rejected once the read-model approach was costed.
- Prisma: heavier runtime and generated client; Drizzle keeps SQL visible, which matters for the exclusion constraints and keyset scans.
- Kafka or a hosted queue: more moving parts than a case study warrants; BullMQ reuses Redis and offers delayed jobs, retries and a dead-letter set out of the box.

---

## ADR-0004: Promotion resolution and effective price

**Status:** Accepted

### Context

Promotions target either one product or a whole category, have a validity window, and the business rule says a product has at most one active promotion. The rule must hold under concurrent admin writes, and a product created inside a promoted category must inherit the discount automatically.

### Decision

Promotions are rows, not rules: `discount_type`, `value`, `starts_at`, `ends_at`, exactly one of `product_id` or `category` once active, and a `status` of `draft`, `active` or `cancelled` (a draft has no target; a cancelled row keeps the shape it had). Two PostgreSQL exclusion constraints (`btree_gist`, `tstzrange(starts_at, ends_at) &&`) guarantee at most one active product-level promotion per product and at most one active category-level promotion per category at any instant. Overlap at the same level fails with `409` and reports the conflicting promotion; there is no silent override.

The rule "at most one active promotion per product" is implemented as **at most one applied promotion**: the product-level promotion if active, else the category-level one, else none. Effective price is one pure function: percentage `base - floor(base * bps / 10000)`, fixed `max(base - value, 0)`. Three mutations exist: create (with a target → `active`, or without → `draft`), assign (`draft` → `active`, target set in the same guarded `UPDATE`, which rejects with `409` when the row is not a draft, when a concurrent assign won, or when its `ends_at` has already passed, and runs the exclusion constraints in the same statement) and cancel. A draft is never applied. Read endpoints for promotions serve the admin path from PostgreSQL. Boundaries are scheduled with delayed BullMQ jobs at `starts_at` and `ends_at`, enqueued at the moment a promotion first becomes active (create-with-target or assign), so an assigned draft reaches the read model immediately.

### Consequences

- Concurrency is solved in the database: two admins assigning to the same product at once get one `201` and one `409`, with no application-side locking.
- A category flash sale skips products that carry their own active promotion, because product level wins. The applied promotion is returned in every storefront response, and the precedence rule is a named test in the design spec's testing section.
- Categories are free text matched exactly; a category promotion whose category matches no product is accepted (products may arrive later through ingestion) and the response reports `productCount: 0` so a typo is visible immediately.
- A separate `assign` step exists because the case lists create, cancel and assign as distinct operations; keeping the target on the promotion row (one target per promotion) makes assign a single constrained `UPDATE` rather than a join table.
- Cancelled promotions stay in the table for audit; the partial `WHERE` on the constraints ignores them, so cancel-then-create works.
- Scheduled starts and expiries change prices at the boundary, not on a cache TTL.

### Trade-offs

- Cross-level coexistence is allowed rather than rejected. Rejecting it would require an application-side check that races; allowing it keeps the database the sole arbiter.
- Percentage discounts round in the customer's disfavour by at most one cent (floor on the discount). Stated, deterministic, testable.
- Reporting the conflicting promotion needs a second `SELECT` after SQLSTATE 23P01; acceptable on an admin path.

### Rejected alternatives

- `product_promotions(product_id unique)` join table: not time-aware (blocks scheduling a future promotion), does not cover category promotions, and materialising category assignments means 50 000 inserts per flash sale.
- Encoding promotions as `json-rules-engine` rules: duplicates the source of truth; promotions are already structured data.
- Precedence by larger discount: surprising for admins who created a product-specific price, and harder to explain on a receipt.

---

## ADR-0005: Chunked, leased, checkpointed ingestion (Scenario A)

**Status:** Accepted

### Context

Weekly vendor files of 500 000+ rows must pass through application-layer pricing rules before reaching the database. The processing unit runs on a serverless consumption plan: a strict timeout of minutes, restricted memory, and no state after the invocation ends. The naive design (stream the file inside one HTTP request, enqueue 5 000-row payloads, let the queue retry whole chunks) fails all three: the request itself times out, row payloads fill the queue's Redis, and a retry restarts a chunk from zero.

### Decision

**Pattern:** register once, then process many small, independent, resumable units.

- The API streams the upload to a file store (local volume; blob storage in production, where a pre-signed upload plus a blob trigger replaces the API hop), hashes it, computes line-aligned byte-range chunks (4 MiB default) in one streaming pass, and stores `ingestion_jobs` plus one `ingestion_chunks` row per chunk. Duplicate files (`file_sha256` unique) and a second concurrent job for the same vendor are rejected with `409`.
- Each chunk is a BullMQ job whose payload is just `{ jobId, chunkIndex }`. `processChunk` is the serverless unit: it claims the chunk with a **lease** (`lease_until`), streams its byte range, splits raw buffers on `0x0A`, parses `vendor_price` decimals to integer cents without floating point, dedupes each 1 000-row batch by SKU, runs the rows through `json-rules-engine` rules loaded from `pricing_rules`, and commits the multi-row upsert together with a **compare-and-set checkpoint** (`where next_offset = $seen`) in one transaction. It stops when its time budget is spent and re-enqueues itself; the checkpoint is already durable.
- **Tools:** BullMQ (retries, stalled detection sized to the budget, failed set as DLQ), `json-rules-engine` for the dynamic pricing rules, Node streams, PostgreSQL `INSERT ... ON CONFLICT`.
- **Database structures:** `ingestion_jobs` (file identity, counters, status), `ingestion_chunks` (byte range, `next_offset`, `lease_until`, `attempts` for resumptions and a separate `failures` counter that alone drives the terminal state), a partial unique index for one running job per vendor, `products.sku` unique for idempotent upserts, and `products.ingest_job_id` plus `products.ingest_source_offset` so duplicate SKUs across chunks resolve by `(job, position in file)` rather than by commit order, which keeps horizontal worker scaling safe.

### Failure modes defended against

- Timeout mid-chunk: loss bounded to one uncommitted batch; the next invocation resumes at `next_offset`.
- Duplicate delivery or two workers on one chunk: the lease and the compare-and-set make the second writer roll back instead of regressing the offset.
- Duplicate SKU inside a batch: deduped before the statement, so PostgreSQL never raises "cannot affect row a second time".
- Multi-byte text and CRLF: offsets are byte counts; a newline cannot occur inside a UTF-8 sequence, so lines decode safely.
- Memory: only one batch and the stream buffers are resident; no per-row events, no whole-file parse.
- Same file twice: the hash rejects it; a re-run after a crash converges to the same rows through the SKU upsert.
- Stuck job: an expired lease is visible as "stuck" and any worker can re-claim; a hand-off at budget end releases the lease before re-enqueueing, and the reconciler re-enqueues orphaned chunks; operators can pause, resume or abort.

### Trade-offs

- Rows for one SKU appearing in different chunks resolve by `(ingest_job_id, ingest_source_offset)`, not commit order, so out-of-order commits from scaled workers cannot regress a later row and an older file cannot clobber a newer one; the cost is two columns and one row-value comparison per upsert.
- The file must be immutable once registered and must not contain embedded newlines; both are stated as the file contract.
- A crash between commit and enqueueing `product.upserted` delays the read-model update until the reconciler runs.
- Locally the "serverless" unit is hosted by a BullMQ worker under Docker memory and CPU limits; the function body is the same, the trigger differs.

### Rejected alternatives

- Row payloads in queue jobs: 500 000 rows in Redis memory and no intra-chunk resume.
- `readline` with character offsets: drifts on multi-byte text.
- A single long-running import process: exactly what the consumption plan forbids.
- An RSS-based memory guard: Node RSS does not shrink, so it either never fires or always fires; batch size bounds memory instead.

---

## ADR-0006: Read model for flash sales (Scenario B)

**Status:** Accepted

### Context

A category promotion must affect tens of thousands of products the moment it is created, the listing endpoint sees massive read traffic while it runs, products added to the category mid-sale must be discounted automatically, and cancellation or expiry must restore prices promptly.

### Decision

**Pattern:** derive, do not store, on the write side; materialise on the read side.

- Creating or assigning a category promotion is one row and one `promotion.changed` event. Nothing touches product rows.
- The event handler scans the category by keyset in batches of 1 000, recomputes each product's applied promotion and effective price from PostgreSQL, and pipelines the read-model writes: `HSET product:{id}`, `ZADD category:{c}`, `ZADD products:all`. Listings are `ZRANGE ... BYSCORE` with offset and limit; detail is `HGETALL`.
- A new product's `product.upserted` recompute finds the active category promotion, so the product is born discounted; it is not visible in the storefront until its hash exists.
- Cancellation removes the delayed boundary jobs and emits an immediate recompute; scheduled starts and expiries fire as delayed jobs at the boundary.
- **Tools:** Redis sorted sets and hashes, BullMQ delayed jobs, `MULTI`/pipelines. **Database structures:** `products (category, id)` index for keyset scans, the exclusion constraints from ADR-0004.

### Failure modes defended against

- Write amplification on the write store: zero product-row updates per flash sale.
- Read traffic reaching PostgreSQL: none; a missing hash is a `404`, an unready read model is a `503`.
- Out-of-order handlers (cancel then assign on one category): a single event-handler instance runs with concurrency 1 and always recomputes from the current truth.
- Missed boundary: the reconciler sweeps promotions whose boundaries passed since its last successful sweep (persisted watermark, ADR-0007) and re-emits the event.
- Cold start or Redis loss: the API triggers a full rebuild and refuses storefront reads until it completes.

### Trade-offs

- During the seconds a 50 000-product recompute takes, listing pages mix old and new prices. Accepted for a catalogue; the atomic upgrade is building `category:{c}:new` and `RENAME`.
- A single serialised event handler is the throughput ceiling for write-to-read latency; per-category locks are the upgrade if one instance falls behind.
- Offset pagination can skip or duplicate a row across a price change between two page requests; cursor pagination is the upgrade.
- Stock is part of the read model and therefore also eventually consistent.

### Rejected alternatives

- Materialised `effective_price` column on `products`: 50 000-row updates per flash sale and a scheduled sweep for expiry.
- Read-time SQL pricing with a TTL cache: correct, but every cache miss is a sort over the category and scheduled starts are late by the TTL.
- A `pricing_rules` layer for promotions: see ADR-0004.

---

## ADR-0007: Safety net and operational recovery

**Status:** Accepted

### Context

The read model, the event bus and chunked ingestion each introduce a way for state to diverge or work to stall. The system must both repair itself and expose handles for an operator to intervene when a backlog builds.

### Decision

Automatic: BullMQ retries with exponential backoff and a kept failed set as the dead-letter queue; stalled-job recovery with `lockDuration` sized to the ingestion time budget; compare-and-set checkpoints so retries resume; `429` backpressure on imports above a queue-depth threshold; a category-scoped reconciler every five minutes (count comparison, sampled price verification, promotion-boundary sweep, ingestion orphan-chunk sweep) that enqueues a scoped rebuild on mismatch; a cold-start full rebuild gated by `readmodel:ready`; workers that finish their batch and exit when heap use crosses a limit, restarted by the container runtime; every handler logs and rethrows so failures are recorded, never swallowed.

Manual, under `/api/admin` and Bull Board: queue statistics, pause and resume per queue, drain, dead-letter retry and discard, per-import pause, resume and abort, and scoped or full read-model rebuild using `SCAN` and `UNLINK` on the read-model database only.

Alarms: the API and workers expose Prometheus metrics (`prom-client`); a `monitoring` compose profile runs Prometheus and Grafana with a provisioned dashboard and alert rules for queue depth, dead-letter jobs, read-model drift, API p95 latency, 5xx rate, worker memory, stuck ingestion chunks and health. Alerts are visible in Grafana Alerting; notification channels are Grafana configuration.

### Consequences

- Any single failure (worker crash, lost event, expired lease, Redis restart) converges without operator action within one reconciler period.
- Operators have a small, orthogonal set of levers: stop intake, stop consumption, retry or discard failures, rebuild a scope.
- The read-model and queue databases are separate, so no maintenance action can destroy queued work.

### Trade-offs

- The promotion boundary sweep runs from a persisted watermark (`reconciler_state.last_boundary_sweep_at`), so an outage of any length is caught up on the first run back, at the cost of one extra row and one write per run.
- The price check in the reconciler is sampled (`max(50, 1 %)` of a category per run, capped at 500), so a single wrong price can survive a run; the exact count comparison and the resampling on every run bound that exposure to minutes, and the manual rebuild remains the override.
- A five-minute reconciler period is the worst-case repair time for a lost event. Shorter periods cost PostgreSQL reads; the sampled check keeps each run cheap.
- A drain deletes waiting work; it requires an explicit confirmation parameter.
- Alerting lives in Grafana rules rather than application code, so thresholds can be tuned without a deploy but are not unit-tested; the metrics that feed them are.

### Rejected alternatives

- Full rebuild on any drift: unnecessary load; scoped rebuilds are sufficient.
- `FLUSHDB` for rebuilds: would erase the queue when it shares the instance.
