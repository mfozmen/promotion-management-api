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

Two workloads pull in opposite directions: the storefront reads (`GET /api/products`, `GET /api/products/:id`) must survive flash-sale traffic, while admin writes and weekly bulk ingestion must remain transactional and race-free. A single relational store serving both would put the hottest endpoint in the system behind the same connection pool as 500 000-row imports.

### Decision

CQRS on a modular monolith. PostgreSQL 16 is the write store and the only source of truth, accessed through Drizzle ORM with SQL migrations (which double as the DDL deliverable). Redis 7 holds the read model the storefront queries: a hash per product and price-ordered sorted sets per category and for all products. BullMQ, running on a separate Redis logical database, carries events from writes to the event-handler worker, which recomputes affected read-model entries from PostgreSQL. One Docker image runs four commands: `api`, `event-handler`, `ingestion-worker`, `reconciler`.

Money is stored as integer minor units, percentages as basis points, timestamps as `timestamptz`.

Locally both stores run from `docker-compose.yml` (`postgres:16-alpine` and `redis:7-alpine`, healthchecked, on named volumes and a named network, with Adminer and redis-commander behind the `tools` profile; the application containers, the migration step and the `monitoring` profile are added on top of it by issue #19). The application takes its wiring from the environment — `DATABASE_URL`, `REDIS_URL` and the two logical-database indexes `REDIS_READ_MODEL_DB` (read model) and `REDIS_QUEUE_DB` (BullMQ) — documented in `.env.example` and read by `loadConfig` in `src/shared/config.ts`, a zod schema that is written and tested but not yet called by any process. Beyond typing and defaults it checks only the three mistakes that would otherwise surface late and quietly: a `DATABASE_URL` carrying no database name, the read model and the queue on the same logical database, and `INGESTION_LEASE_MS` below `INGESTION_BUDGET_MS`; everything else fails on its own at first use. The module that opens a Redis connection derives its URL from `REDIS_URL` plus the index. `loadConfig` has no consumer yet, deliberately: the first module that needs a connection wires it in and reconciles the duplicate `PORT` read in `src/server.ts`, so it is pending work rather than dead code. The connection URLs are the only source of truth for where the application connects. The database name is required because node-postgres would otherwise fall back to `PGDATABASE`, then the user name, then the OS user, so an omitted name connects to something and the mistake surfaces later as missing tables. `REDIS_URL` needs no equivalent check: the index, not the URL path, picks the logical database. `docker-compose.yml` publishes 5432 and 6379 on `127.0.0.1` as literals rather than through `POSTGRES_PORT` and `REDIS_PORT` overrides, and nothing must reintroduce those two variables: they are the names Kubernetes injects for Services called `postgres` and `redis`, in the form `POSTGRES_PORT=tcp://10.96.1.5:5432`, so they are not ours to read. A cross-check against a variable this application does not own adds a failure mode and buys nothing — it briefly did, and with a sidecar proxy making `DATABASE_URL` loopback it would have crash-looped every pod in the namespace at startup, blaming a compose file that deployment never had. A developer whose 5432 is occupied edits the compose file and the URL together.

Four settings in that file are deliberate and would otherwise look arbitrary. Redis runs with `--appendonly yes`, because the queue database holds jobs that must survive a restart of the container, and with no `maxmemory`, so the default `noeviction` policy holds: the read model carries no TTL by design and must never be silently evicted. PostgreSQL runs with `log_lock_waits=on` and `deadlock_timeout=200ms`, because the defaults (off, 1 s) would let the deadlock scenario report "no deadlock" from a run that never looked. Every published port binds `127.0.0.1`, including the two `tools` browsers, so a laptop on a shared network offers neither a database nor a browser for one. `rediscommander/redis-commander` is the one unpinned image: the publisher ships no version tags at all, only `latest` and a few branch tags, and the container is dev-only behind the profile. Adminer stands in for the pgAdmin issue #4 names as an example, being one container with no setup.

The compose file itself carries no comments: it states what runs, and why any of it runs that way is here.

The PostgreSQL healthcheck runs a real `psql` query rather than `pg_isready`, which only sends a startup packet and reports "accepting connections" (exit 0) for a database that does not exist. Measured against this stack: `pg_isready -U promo -d nosuchdb` exits 0, the `psql` check exits 2. What it catches is a **database name or role** that no longer matches an already-initialised volume, which is the drift `depends_on: service_healthy` would otherwise start a crash loop behind.

It does **not** catch a changed `POSTGRES_PASSWORD`, and nothing in the container can. The image generates `pg_hba.conf` at volume initialisation with `local all all trust` and `host all all 127.0.0.1/32 trust`, so a healthcheck running inside the container never authenticates whichever way it connects, and the file is not regenerated for an existing volume. A password changed in `.env` against a populated `postgres-data` therefore still reports healthy; it surfaces at the first consumer's connect as `password authentication failed`, and the operator's fix is `docker compose down -v`. `psql` reads the user and database from the container's own environment and is passed no password at all, so nothing secret reaches the process list.

### Consequences

- Storefront reads never touch PostgreSQL; their cost is one or two Redis round trips regardless of promotion activity.
- Every read-model write is a recompute from PostgreSQL, so handlers are idempotent and retry-safe; the event-handler runs with concurrency 1 to keep them ordered.
- The read model is eventually consistent: a write is visible after the handler runs, typically well under a second for single products and a few seconds for a 50 000-product category.
- Redis is a hard runtime dependency; an empty read model answers `503` until the cold-start rebuild completes.

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

Promotions are rows, not rules: `discount_type` of `percentage` or `fixed`, `value` in basis points or minor units, `starts_at`, `ends_at`, exactly one of `product_id` or `category` once active, and a `status` of `draft`, `active` or `cancelled` (a draft has no target; a cancelled row keeps the shape it had). The enum is the case's own vocabulary, and a third kind of discount is a migration that widens it — the right cost, because a vocabulary a reader can enumerate is worth more than one that can hold anything. Two PostgreSQL exclusion constraints (`btree_gist`, `tstzrange(starts_at, ends_at) &&`) guarantee at most one active product-level promotion per product and at most one active category-level promotion per category at any instant. Overlap at the same level fails with `409`, saying that an active promotion already covers the target and carrying no field of the conflicting row (REVIEW.md 8.3b: a response never hands a caller another row's data). There is no silent override. The cost is that an admin who hits a `409` reads the promotions endpoint to see what blocked them, rather than learning it from the error.

Which candidate applies is decided by `json-rules-engine` rules stored in `pricing_rules` (`type = 'promotion'`) and cached for 60 seconds, not by hard-coded precedence (owner decision, 2026-09-12). The resolver computes each candidate's discount first, then hands the engine a single fact object holding both candidates, so a rule can compare them; the highest-priority rule that fires names the winning level, an equal price decided by the `<=` in the seeded `lower-price-product` rule rather than by a tiebreak in code — the exclusion constraints already guarantee one candidate per level, so a resolver-side id tiebreak would be a branch no test could reach; the seeded default rule gives the customer the lower of the two effective prices, so a category flash sale covers a product that carries its own promotion rather than skipping it. A higher-priority rule overrides that default by naming the other candidate, which is how a deliberately set product price survives a category sale; it cannot select nothing, so a product with no promotion of its own cannot be held out of one without a `level: 'none'` the event vocabulary does not have. Changing the policy remains a row edit rather than a deploy.

**The rule decides which candidate wins; it does not decide how one is computed.** A matching rule's event names the winner and nothing else: `{ type: 'selectCandidate', params: { level: 'product' | 'category' } }`. The arithmetic is one pure function over a typed row — `applyPromotion(basePriceCents, promotion)` in `src/modules/promotion/`, returning a `PricingOutcome` discriminated union of `{ ok: true, effectivePriceCents }` or `{ ok: false, reason }`, so a failure carries no price a caller could publish by mistake. There is no calculator registry, no parameter bag and no factory; that design was tried on this branch and the owner reversed it (2026-09-12). Dynamic pricing rules for ingestion live in `src/modules/pricing/` with their own adjustment semantics, and neither module imports the other.

The rule "at most one active promotion per product" is implemented as **at most one applied promotion**: whichever candidate prices the product lower under the seeded rule, or whichever a higher-priority rule names, and none if no rule fires. The arithmetic lives in that one function and nowhere else (REVIEW.md 1.3): percentage is `base - floor(base * bps / 10000)`, fixed is `max(base - value, 0)`, computed in `bigint` and clamped into `[0, base]`. Three mutations exist: create (with a target → `active`, or without → `draft`), assign (`draft` → `active`, target set in the same guarded `UPDATE`, which rejects with `409` when the row is not a draft, when a concurrent assign won, or when its `ends_at` has already passed, and runs the exclusion constraints in the same statement) and cancel. A draft is never applied. Read endpoints for promotions serve the admin path from PostgreSQL. Boundaries are scheduled with delayed BullMQ jobs at `starts_at` and `ends_at`, enqueued at the moment a promotion first becomes active (create-with-target or assign), so an assigned draft reaches the read model immediately.

### Consequences

- Concurrency is solved in the database: two admins assigning to the same product at once get one `201` and one `409`, with no application-side locking.
- Under the seeded default a category flash sale covers products that carry their own active promotion rather than skipping them, because the lower price wins. The applied promotion is returned in every storefront response, so an admin can see which candidate won. A product that must not be discounted further is expressed as a higher-priority rule, not as code.
- The retired shape is unconstructible in the application and unstorable in the database, and both halves are written, each on an open pull request rather than on `main`. `src/modules/promotion/promotion.ts` on PR #29 (`1e624f5`) declares `DiscountType` as `percentage | fixed` and a `Promotion` interface carrying `discountType`, `value`, `status`, `startsAt` and `endsAt` — no `calculator` field and no parameter bag to put one in, so a promotion naming a calculator class does not typecheck, and `applyPromotion` branches on the two literal types with no registry lookup to reach. `src/shared/db/migrations/0000_write_store.sql` on PR #50 (`e48dee9`) went back to a `promotion_discount_type` enum plus `value integer`, with `check (value > 0)` and the 10 000 basis-point ceiling, so there is no `calculator text` or `params jsonb` column left for such a row to sit in. Until those two merge, `main` carries neither shape: the claim is about the branches, not about a deployed database.
- Categories are free text matched exactly; a category promotion whose category matches no product is accepted (products may arrive later through ingestion) and the response reports `productCount: 0` so a typo is visible immediately.
- A separate `assign` step exists because the case lists create, cancel and assign as distinct operations; keeping the target on the promotion row (one target per promotion) makes assign a single constrained `UPDATE` rather than a join table.
- Cancelled promotions stay in the table for audit; the partial `WHERE` on the constraints ignores them, so cancel-then-create works.
- Scheduled starts and expiries change prices at the boundary, not on a cache TTL.

- **No test pins the runtime policy, and that is what makes "the policy is data" true rather than decorative.** A test asserting whichever row a running database holds would make it unchangeable without turning CI red, and a policy that cannot change is not data. Tests assert the mechanism instead — given a rule row the test itself inserts, the engine selects that candidate. Two things that look alike are not: a test that reads the **seeded** rules out of the migrated database tests code — the seed is a migration row, reviewed and changed by commit, and changing it changes the test with it, as with any code. A test that pinned the **runtime** row would be something else entirely: an operator editing that row in a running database changes neither code nor test, so CI stays green and the policy really is data. Both halves have to be said, or the rule reads as forbidding the first.
- The seed is **four** rules, not three: a `json-rules-engine` rule carries one event, and "the lower price wins" is two outcomes. One rule comparing the candidates could name only one level, and the other comparison would fire nothing — publishing a base price in the middle of the sale. A reader counting the rules should not conclude one is missing.
- Priorities 10–30 are reserved for the seeded rules; an operator override sits above 30, or it is shadowed by `product-only` for the arity-one products that rule also names, and the same intent then behaves differently depending on whether a category sale happens to be running.
- **The rule set is cached for 60 seconds and nothing invalidates it.** After a policy edit, workers hold two policies for up to a minute, and thereafter only products that receive an event are re-resolved directly. The reconciler's sampled sweep heals the rest, comparing a sample per category against PostgreSQL and enqueueing a rebuild on a mismatch, so the exposure is probabilistic across several runs rather than indefinite — a weaker guarantee than it sounds, which is why it is recorded rather than left to be discovered. Closing it properly needs a version to compare against (`pricing_rules.updated_at` is the obvious carrier; there is no version column today) and a write path to hang a trigger on (section 10 has no `pricing_rules` endpoint). Neither is built here.

### Trade-offs

- Precedence lives in data, so a wrong or missing rule changes prices without a code review. The mitigation is that the seeded default ships in a migration and is version-controlled, every later change is an ordinary row update that the table's `updated_at` records, and a rule naming an unknown candidate is ignored and logged rather than applied. Changing the policy therefore needs no deploy, which is the point, and `updated_at` records only when the current policy arrived, not what preceded it, and no published price names the rule that selected it — so this is a weaker audit trail than the git history it replaces, not a stronger one.
- `json-rules-engine` returns **every** matching event, not the first, and does not stop at a success. The resolver therefore selects the event whose rule carries the highest `priority` in `results` rather than reading `results[0]`: buckets run in descending priority but rules inside a bucket run concurrently, so positional order is an implementation detail the library does not promise across versions. Distinct priorities are a seed contract rather than a convention, and a collision is logged at load.
- Protecting a deliberately set product price inside a category sale means writing an operator rule above priority 30, so the protection is itself an un-reviewed row, carrying the same absent audit trail as the policy it overrides.
- The engine adds a per-resolution evaluation over at most two candidates. That cost lands on the event handler and the reconciler, never on a storefront read, because the read model stores the already-resolved price.
- Cross-level coexistence is allowed rather than rejected. Rejecting it would require an application-side check that races; allowing it keeps the database the sole arbiter.
- Percentage discounts round in the customer's disfavour by at most one cent (floor on the discount). Stated, deterministic, testable.

### Rejected alternatives

- `product_promotions(product_id unique)` join table: not time-aware (blocks scheduling a future promotion), does not cover category promotions, and materialising category assignments means 50 000 inserts per flash sale.
- Encoding the promotions themselves as `json-rules-engine` rules (rather than the policy that selects between them): that would duplicate the source of truth, since a promotion's type, value, window and target are already structured columns that the constraints and the scheduler operate on. The rules decide precedence; the rows stay the promotions.

---

## ADR-0005: Chunked, leased, checkpointed ingestion (Scenario A)

**Status:** Accepted

### Context

Weekly vendor files of 500 000+ rows must pass through application-layer pricing rules before reaching the database. The processing unit runs on a serverless consumption plan: a strict timeout of minutes, restricted memory, and no state after the invocation ends. The naive design (stream the file inside one HTTP request, enqueue 5 000-row payloads, let the queue retry whole chunks) fails all three: the request itself times out, row payloads fill the queue's Redis, and a retry restarts a chunk from zero.

### Decision

**Pattern:** register once, then process many small, independent, resumable units.

- The API streams the upload to a file store (local volume; blob storage in production, where a pre-signed upload plus a blob trigger replaces the API hop), hashes it, computes line-aligned byte-range chunks (4 MiB default) in one streaming pass, and stores `ingestion_jobs` plus one `ingestion_chunks` row per chunk. Duplicate files (`file_sha256` unique) and a second concurrent job for the same vendor are rejected with `409`.
- Each chunk is a BullMQ job whose payload is just `{ jobId, chunkIndex }`. `processChunk` is the serverless unit: it claims the chunk with a **lease** (`lease_until`), streams its byte range, splits raw buffers on `0x0A`, parses `vendor_price` decimals to integer cents without floating point, dedupes each 1 000-row batch by SKU, runs the rows through `json-rules-engine` rules loaded from `pricing_rules` where `type = 'ingestion'` (the same table also holds the promotion-precedence rules of ADR-0004, cached separately), and commits the multi-row upsert together with a **compare-and-set checkpoint** (`where next_offset = $seen`) in one transaction. It stops when its time budget is spent and re-enqueues itself; the checkpoint is already durable.
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
- Storing the promotions themselves as `pricing_rules` rows: see ADR-0004. The `pricing_rules` layer is used for promotions, but only to select between candidates; the promotions stay rows.

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

---

## ADR-0008: HTTP boundary contract — `/api` prefix, strict validation, one JSON error envelope

**Status:** Accepted — issue #6, PR #30 (branch `feat/http-skeleton`, commit `7fd588e` plus the review-fix commits `e46f14b`, `c6e4ff2`, `ccef8a4`, `de3bf9e`, `af38e0c`, `4f10c7f`, `a218bf2`, `9f27f8d`, `5f4da57`, `ec623cc`, `30bc002`, `f621699`, `4ec8a35`, `f4a27c0`, `acc81ae`, `a624f6a`, `a2c8a1a` and `459686b`)

### Context

Every endpoint in ADR-0003 to ADR-0007 (storefront reads, admin promotion mutations, ingestion, `/api/admin` operations) has to agree on where it is mounted, how untrusted input is rejected, and what an error looks like. Deciding that per route produces three shapes of 400 and leaks Express defaults — an HTML 404 page, a stack trace on an unexpected throw — to clients.

### Decision

- **Prefix.** Everything is mounted on an `express.Router()` under `/api`, including the liveness probe, which moves from `GET /health` to `GET /api/health`. One prefix means one reverse-proxy rule for the API and no split between "infrastructure" and "application" paths. Two surfaces sit outside it by design, and are the only ones: the queue dashboard at `/admin/queues` and the Prometheus scrape at `/metrics`, both operator-facing rather than client-facing, and neither speaks the error envelope below.
- **Validation at the boundary.** `src/shared/http/request-validator.ts` takes `{ body?, query?, params? }` zod object schemas, calls `.strict()` on them **once at route construction**, and replaces each request part with the parsed, typed value. A handler never sees raw input **for the parts it declares a schema for**; a route that validates only `params` still reads `req.body` raw, so every part a handler touches is declared. `.strict()` makes an unknown field a `400` instead of a silently ignored client typo — a misspelled `catgeory` filter must not return an unfiltered catalogue. It applies to the **top level only**: a nested object declares its own strictness with `z.strictObject(...)`, or a misspelled field inside it is silently dropped. The convention is repeated in the `validate` JSDoc, and `tests/unit/shared/http/request-validator.test.ts` holds the case that keeps it honest. Compiling the strict schema at construction rather than per request keeps the hot storefront path free of per-request schema _compilation_ (REVIEW.md §6.6); validation itself is per request, one `safeParse` for each declared part, and that is the cost the listing PR sizes against. `req.query` is a getter in Express 5, so the parsed value is installed with `Object.defineProperty`.
- **Process lifecycle is not decided here.** `server.ts` calls `app.listen` with Node's default 5 s keep-alive and no `SIGTERM` handler, so a deploy cuts in-flight requests and a load balancer with a longer idle timeout will see intermittent 502s on the storefront path. The owner deferred draining deliberately for a skeleton; it is named here so the story that puts this behind a load balancer owns both the drain and a keep-alive above that balancer's idle timeout. `server.ts` is excluded from coverage, so no test will notice for us.
- **One realm.** `err instanceof HttpError` is the only thing that tells our errors from foreign ones, so the tree is assumed to load `http-error.js` once. A duplicate copy of the module, through ESM and CommonJS interop or two specifiers for one file, would turn every 404 and 409 into a masked `500 INTERNAL`.
- **What `details` may hold.** A closed list of `{ path, message }`, which the validator produces and nothing else composes. It was `unknown`, and an `unknown` reaches `res.json` uninspected: a handler attaching a row with a `bigint` price, as ADR-0003's money columns require, threw inside the envelope and fell through to Express's HTML error page with the status intact — a JSON client parsing a `409` got a document. The type is the control, and a caller who casts past it gets that failure back.
- **What a log line may hold.** `serializeError` walks the whole cause chain, not one step: a repository that interpolates a driver message into its own sits between the handler's error and the statement, and a single step lands on that wrapper, which carries no field marking it. A message repeating any statement or bound value the chain holds is replaced; a driver's own message survives, because the constraint name in it is what diagnoses the failure.
- **What the validator costs.** One `safeParse` per declared part, and with it a deep clone of the parsed value and one `Object.defineProperty` on `req` to install it, which puts the request object into dictionary mode for the rest of the chain. The read-path story sizes against that sentence, not against the parse alone. `express.json` also runs ahead of the not-found handler, so a request to a route that does not exist still pays a body parse bounded by the 100 kB cap before its 404; that is the layer's only unmetered work.
- **One error envelope.** `src/shared/http/error-handler.ts` emits `{ error: { code, message, details? } }` and nothing else. `HttpError(code, message, details?)` (`src/shared/http/http-error.ts`) maps straight through, giving the catalogue the later PRs draw from: `400 VALIDATION_ERROR`, `404 NOT_FOUND`, `409 CONFLICT` (ADR-0004 exclusion-constraint overlap), `429 BACKPRESSURE` (ADR-0007 queue depth), `503 READ_MODEL_NOT_READY` (ADR-0003 cold start). Body-parser failures are translated by **status**, not by name: body-parser marks its own errors the http-errors way, with a `status` and `expose === true`, so **any** exposed client error keeps its status — `400 VALIDATION_ERROR` for a body that cannot be read whatever made it unreadable, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE` for a charset the parser will not decode, and `BAD_REQUEST` under its own status for anything else the parser grows. Enumerating instead is what this rule replaces, twice over: first two `err.type` values, then three statuses, each leaving the rest to be masked as `500 INTERNAL` and to page the on-call for a caller's mistake. An error we did not construct is trusted only when it is marked `expose === true` **and** carries an integer status in `[400, 499]`; anything else — a 5xx, a non-integer, a number Express cannot write — is masked as `500 INTERNAL`, message and all. The messages are ours, because body-parser's quote the input back. A 4xx message a handler writes crosses to the client as written, bounded at 200 characters by the envelope but not inspected, so REVIEW.md 8.3b is an obligation on whoever writes it: name what the caller sent, never what a row holds. `details` is always a list and is bounded by count, never inspected for what a caller may read. The two codes that mean come back later, `429 BACKPRESSURE` and `503 READ_MODEL_NOT_READY`, carry a `Retry-After` of five seconds, because a client given no number retries as fast as it can and amplifies the outage it just met.
- **The tables the envelope answers from are frozen through their rows.** `CLIENT_ERRORS` and `OTHER_CLIENT_ERROR` (`src/shared/http/client-errors.ts`, `src/shared/http/other-client-error.ts`), `SERVER_FAULT` and `SERVER_MESSAGES` are spread into a response body, so a shallow freeze — which holds the key-to-row binding and leaves every row writable — would let one assignment from any consumer rewrite the body of every `413` in the process. Each row is frozen individually, and the retriable list is a frozen array rather than a `ReadonlySet`, whose `.add` a freeze does not stop and whose readonly type is erased at build time (commit `f4a27c0`).
- **Each error bound is one constant with a file of its own.** `MAX_DETAILS` (`src/shared/http/max-details.ts`) is read by the validator, which bounds the work of building the list, and by the envelope, which bounds what is returned; `MAX_MESSAGE` (`src/shared/http/max-message.ts`) is read by the envelope and by the logger. Each had two copies kept in step by a comment claiming they matched, which is a coupling nobody maintains. A bound with more than one enforcement point earns a module; the two shared `error-bounds.ts` until REVIEW.md 8c.2 was read as one exported declaration per file, which retired that file (commits `acc81ae`, `6b4203c`, `a624f6a`).
- **The boundary is one directory named for what it does.** The whole HTTP boundary — the error class, its code vocabulary and status table, the two handlers, the validator and the request logger — lives in `src/shared/http/`, with its tests mirrored at `tests/unit/shared/http/`. It was `src/middleware/`, which named a kind of Express syntax rather than a role and could not hold the logger or the error class without lying; REVIEW.md 8c.7 is the rule, and the move is commit `459686b`. Inside it every file holds one exported declaration (8c.2), so `http-error.ts` is the class alone and `error-code.ts`, `status-by-code.ts`, `client-errors.ts`, `other-client-error.ts`, `max-details.ts`, `max-message.ts`, `validation-detail.ts` and `not-found-handler.ts` each stand on their own (commits `a624f6a`, `a2c8a1a`). The root logger and `serializeError` stayed in `src/shared/logger.ts`: REVIEW.md 8.4 makes that whitelist the one implementation every logging site uses, and the ingestion worker and the queue consumers do not serve requests, so putting it inside the HTTP role would have sent them across a boundary or given them a second copy. Only the correlation id and the `pino-http` wiring are HTTP, and they are `http-logger.ts`. Trade-off: fourteen small files where three would do, and an import list at the top of the handler that is longer than the rule it enforces. Accepted because each of these is a boundary contract other modules will import — the code set, the status table, the two bounds — and a grep for one of them lands on its definition rather than on a grab-bag module.
- **The envelope holds only before the first byte.** If a handler has already written part of a response and then fails, there is nothing to put an envelope on: the error handler logs it through the ADR-0009 whitelist and calls `res.destroy()` rather than `next(err)`, so the client sees a truncated body rather than a complete one with an error appended, and the error is never handed to Express (commit `c6e4ff2`). Any future streamed listing must treat a mid-stream failure as a broken connection, not as a `500` document.
- **A 5xx never returns its message, whoever raised it, and its code has to be earned.** The masking rule is not "errors we did not construct": an `HttpError` carrying a 5xx is a server fault whose message was written for an operator, so the raiser's message never crosses — it goes to the log at `error`, and the client reads words of ours. The code crosses only where those words exist: `SERVER_MESSAGES` holds the public wording per code (`READ_MODEL_NOT_READY` → "The read model is not ready yet; retry shortly"), and a 5xx code with no entry answers `500 INTERNAL`, because a code a client cannot act on and a message it must not read leave nothing to send. A handler's `details` never crosses on a 5xx either. The log line carries the code and status the client received alongside the serialized error, because `serializeError` reports the code of the root of the cause chain: without them a 503 raised over a refused connection would be recorded only as the driver's failure. A foreign 4xx loses its original message on both paths, response and log, which is the accepted cost of never forwarding a parser's wording; when a `415` storm needs diagnosis the fix is to log the parser's `type`, never its message. The raised path needs no status guard at all, because the status is derived from the code (see below); the bounded integer check that remains guards only **foreign** errors, which carry a status of their own — Express 5 throws a `RangeError` for a status outside `[100, 999]`, which is the HTML-error-page leak two earlier rounds closed. The foreign-error trust rule is stated once, in the envelope bullet above, and applies here unchanged (commits `de3bf9e`, `9f27f8d`).
- **The rejected keys are logged at `warn`, not `debug`.** The root logger runs at pino's default `info`, so a `debug` line is a mitigation that never fires in production while passing every test — which is what the first version of this did. Field names only, never values, and bounded in count **and** in bytes — the first 20 keys, each cut to 64 characters, with the full count alongside — because both the number of unknown keys and their length are the client's to choose, and this line is written on an unauthenticated path: 20 keys of four kilobytes is an 80 kB line per request. The cap had been claimed here and pinned by no test until a case posted 25 keys of 200 characters and asserted both bounds (commit `4f10c7f`). An `HttpError` message must therefore never carry a credential: on a 5xx it goes to the log and not to the client, but it does go to the log. `tests/unit/shared/http/request-validator.test.ts` builds the logger at `info` so the mitigation cannot silently stop firing again (commit `af38e0c`).
- **`HttpError` does not take a status.** `HttpError(code, message, details?)`, and `STATUS` (`src/shared/http/status-by-code.ts`), a `Record` exhaustive over the closed vocabulary, says what each code answers with. The pairing rule this replaces was wrong in three different directions across three consecutive commits — a code surviving a status it did not match, then the status dropped along with the code, then a code accepted under any 5xx at all. Each fix was right about what it aimed at and wrong about what stood next to it, because one decision was being restated in three places. It is now unstateable: `new HttpError(404, 'CONFLICT', …)` does not compile, both status-range guards inside the raise path are gone, and the REVIEW.md rule that would have asked authors not to write it is not needed. A rule cannot be broken by code that cannot express the violation. `STATUS` is **one-way**: it is the status for a code _we_ raise, not a reverse map. A foreign exposed 4xx — body-parser's, or anything with `expose: true` — keeps its own status and is given the nearest code, so a `418` answers `BAD_REQUEST` while that code's row reads `400`; an SDK generated from the table would be wrong about that case. The value type is the literal union `400 | 404 | 409 | 413 | 415 | 429 | 500 | 503`, so the range invariant is held by the compiler rather than by a unit test: a typo like `4004` no longer compiles (commit `9f27f8d`). Body-parser's own errors are untouched by all of this: they are foreign, carry their own arbitrary 4xx, and never construct an `HttpError`.
- **The cost, stated rather than discovered:** `502` and `504` are no longer expressible, because no code in the vocabulary maps to them. They are also **unreachable**: no spec in this repository describes an outbound HTTP call, so no handler could raise either, and the "a 5xx keeps its status" behaviour two earlier rounds argued over was preserving a signal nothing produces. This is not a gap to re-litigate. Adding one is a code and a row in `STATUS`, decided together, which is the point — the alternative was any handler being able to invent a status for any code.
- **A rejection names where, and which of the caller's own keys — never a value.** The line REVIEW.md 8.3b draws is between an identifier and an input: a key the caller _typed_ is something they can act on, and without it they cannot fix the request, so `Unrecognized keys (1): "basePrice"` comes back. A value they sent is just their own input handed to them again, and a stored value is not theirs at all; neither crosses. Keys are truncated at 64 characters rather than omitted (8.3c) and the list is capped, because how many a request carries is the caller's choice and this path is unauthenticated. The count is emitted alongside so a truncated list is visibly truncated. This PR had it the other way round for two commits, withholding the key entirely, which is stricter and worse: it left a client unable to find its own typo.
- **The echo rule leans on zod's messages, and that is the author's obligation.** Nothing in `toDetails` inspects a message for a caller's value; it rewrites the one issue type that quotes a key and passes the rest through, because every built-in zod message quotes the schema's own bounds, literals or type names rather than the input. A `.refine(..., { message: \`${value} is invalid\` })`or a`z.custom`would put a value straight into`details[].message` and no guard would catch it. That is a rule for whoever writes the schema, stated here because a guard that inspected every message would be guessing at which substring came from the caller.
- **One error vocabulary.** `ErrorCode` in `src/shared/http/error-code.ts` is the closed set of codes the API can answer with, so the boundary cannot invent a ninth spelling and a client can branch on a finite list. It is a type, not a runtime table: the compiler rejects an unknown code at the call site, which is where the mistake is made.
- **`Retry-After` is a band, not a number.** `429` and `503` answer with five to ten seconds, chosen per response. A flat hint has every client that met the outage return in the same second, so a read model's first healthy moment takes the whole backlog as one burst — the stampede ADR-0006 keeps out of the read path, arriving from the callers instead.
- **A rejected request writes two `warn` lines**, one from the validator naming the keys and one from the envelope naming the code. On an unauthenticated path at flash-sale volume that is the log amplifier ADR-0009's unbounded destination turns into heap; the listing story that makes this path hot samples or aggregates the validator line.
- **Unknown routes** hit `notFoundHandler` (`src/shared/http/not-found-handler.ts`) before the error handler, so a typo gets JSON `404 NOT_FOUND` rather than Express's HTML page. The requested path is not echoed back, because the caller already knows the path it asked for, so echoing buys no diagnostic the log does not already have — not because it is untrusted, which a rejected key equally is.
- **Body cap.** `express.json({ limit: '100kb' })`. JSON routes carry a single entity; vendor files arrive as a multipart stream (ADR-0005), never as a JSON body.
- **Stack logged, never returned.** An unexpected error is logged with `req.log.error({ error: serializeError(err) })` — stack frames, error type, message and SQLSTATE — and the client receives only `{ code: 'INTERNAL', message: 'Internal server error' }`. REVIEW.md §8.4 was amended in this PR — as its own preamble requires when a rule and the design disagree — and now reads as a general rule rather than as a description of this change: the response carries nothing internal, and the log carries the stack but never SQL text, bound parameters or secrets. The error is never handed to a logger as an object, because a driver error carries the failing statement and the request body on its own fields and in its message; the whitelist in ADR-0009 is what reaches the line.

### Consequences

- A client can branch on `error.code` without parsing prose, and `details` carries the per-field `{ path, message }` list from zod only where it exists.
- Every later endpoint inherits rejection behaviour by declaring a schema; there is no per-route error formatting to review.
- `HttpError` is the seam for a database-enforced conflict: the promotion handler catches SQLSTATE `23P01` from the exclusion constraint — which drizzle-orm puts on `err.cause.code`, not on `err.code`, because it wraps the driver error — and throws `HttpError('CONFLICT', ...)` with a message naming the target the caller asked for, and nothing read from the conflicting row (REVIEW.md 2.1 puts that mapping in the handler, where the message can be specific; 8.3b bounds what it may say). The middleware deliberately does not map SQLSTATEs globally, which would answer every constraint with one vague sentence. Nothing here pushes a handler toward a check-then-insert overlap query.
- The 100kb cap is a denial-of-service bound as much as a correctness one, **for JSON routes**: `express.json` ignores any other content type, so a large `multipart/form-data` or `text/plain` body passes this layer untouched. The one route where REVIEW.md §8.6 really bites is the vendor upload, and its byte and part limits are a separate decision that ADR-0005's ingestion PR owns; until that PR lands no route reads a non-JSON body.
- Moving the probe to `/api/health` is a breaking change to any existing health-check configuration; it is made now, while the only consumer is the README.

### Trade-offs

- `.strict()` rejects forward-compatible clients that send extra fields. Accepted: this is an internal admin and storefront API, and a silently ignored typo is the worse failure.
- A single envelope means `details` is one closed shape for every endpoint — `ValidationDetail[]` (`src/shared/http/validation-detail.ts`) — so an endpoint that wants to return something else has to widen the type and argue for it here first. Accepted: only the validation path populates it today, and the earlier `unknown` is what let an unserialisable value reach `res.json` (commit `23821cc`).
- The body-parser mapping gives every unreadable body one `400 VALIDATION_ERROR` with one message: a client cannot tell malformed JSON from a dropped connection without reading its own request. Accepted — the alternative, echoing body-parser's own message, quotes the input back into a response. The status, though, is always the parser's own: an earlier version of this ADR claimed `415` was unreachable and cited a probe, and the probe had set `content-encoding`, never a charset. `Content-Type: application/json; charset=iso-8859-9` raises `415` on the installed parser, and `tests/unit/app.test.ts` now asserts it. That is the reason the mapping has a default branch instead of a list.
- A 100kb cap is a guess until a real payload argues otherwise; raising it is a one-constant change.
- The `page`/`pageSize` schema in `tests/unit/shared/http/request-validator.test.ts` is a demonstration of bounded numeric query validation, **not** the storefront pagination contract. Offset paging over a 500 000-row catalogue is what REVIEW.md §6.9 rejects; the listing PR decides between keyset and offset on its own evidence and must not inherit the fixture.
- The process has no `SIGTERM` handling yet: a deploy cuts in-flight requests instead of draining them. Out of scope for a skeleton with one route, and it lands with the first real endpoint.
- Destroying the socket after `res.headersSent` gives the client an unexplained connection reset instead of a delegated Express response. Accepted, and it is the point: `next(err)` reached Express's final handler, which writes the raw `err.stack` to stderr (`logerror` in `express/lib/application.js`, on every env except `test` — the one the suite runs in), and the first line of a stack is the error's own message, which for a `DrizzleQueryError` is the statement and its bound parameters. The client already had a truncated body either way, so the only thing given up is Express's stderr line, and the whitelist now has no path around it (commit `c6e4ff2`).
- Peak RSS under load is a V8 heap question, not an application one, and the variance between runs is larger than any single figure: across nine runs `e2e-tester` measured peaks from 181 to 257 MB at `-c 100` and 207 to 232 MB at `-c 50`, one of them over the 256 MB container the design assumes, each returning to 59 MB afterwards. Quoting one sample as the number was wrong twice in this PR. **Nothing caps the heap today**: there is no Dockerfile, `start` is a bare `node dist/server.js`, and no `--max-old-space-size` or `NODE_OPTIONS` is set anywhere in the repository. Setting it below the container limit is the mitigation and it belongs to the PR that adds the container.
- Latency has the same problem and the same answer. `p99` on `GET /api/health` — a route that serialises `{"status":"ok"}` — measured 37 to 81 ms over nine runs at `-c 50` across two sessions, median 37 to 41 ms depending on the session, with the spread inside one session only 4 ms — so the variance that matters is between sessions, not between runs, and 130 to 192 ms at `-c 100`. The read-path PR should budget against "37-41 ms median, 37-81 ms observed" rather than the low end, and should know that a route doing nothing already spends that much, so the headroom Redis work gets is smaller than the bar suggests. One reading that straddles a threshold is noise; the `e2e-tester` definition now requires the median of at least three runs for any number compared against a criterion.

### Rejected alternatives

- Per-route `try`/`catch` with ad-hoc `res.status().json()`: three shapes of 400 and no single place to mask stacks.
- RFC 7807 `application/problem+json`: more ceremony (`type` URIs) than a single-consumer API needs, and the case study asks for no particular media type.
- Validating inside handlers: the raw value stays reachable, so a handler can use the unvalidated field by accident.
- `express-validator`: a second schema language next to the zod types the domain layer already needs.
- Echoing the unknown path in the 404 message: reflects untrusted input into a response body for no diagnostic gain the log does not already give.
- Withholding the rejected key entirely and reporting only a count at its location: what this branch did for two commits (`de3bf9e` to `a218bf2`, reversed in `ec623cc`). Stricter and worse — a key is an identifier the caller typed, not a stored value, and a `400` that will not say which field was wrong is one the client cannot act on.

---

## ADR-0009: Structured logging with a validated correlation id

**Status:** Accepted — issue #6, PR #30 (branch `feat/http-skeleton`, commit `7fd588e` plus the review-fix commits `e46f14b`, `c6e4ff2`, `ccef8a4`, `87b0a49`, `f621699`, `acc81ae` and `459686b`)

### Context

A request in this system does not end at the HTTP response: it emits an event that a BullMQ worker picks up later (ADR-0003), and an ingestion request fans out into chunk jobs that run minutes apart (ADR-0005). Diagnosing "this price is wrong" means joining an API line to a worker line. `console.log` gives neither structure nor a join key.

### Decision

`src/shared/http/logger.ts` exports a pino root logger and a `pino-http` middleware, mounted first in `createApp` so every later middleware and handler has `req.log`.

- **Correlation id.** Taken from the incoming `x-request-id` header **only when it matches `^[A-Za-z0-9._-]{1,128}$`**; otherwise a `randomUUID()` is generated. The header is untrusted input: a value containing a newline would forge whole log lines, and one containing CR would inject a response header. The id is echoed in the `x-request-id` response header and bound as `reqId` on every line through `quietReqLogger: true`. One "request completed" line closes each request — except a 5xx, which pino-http closes with its own "request errored" line. That line carries an error pino-http constructs itself (`failed with status code 500`), not the one the handler caught, so it is synthetic and outside §8.4's reach; it is the one place in the process where an error object is handed to a logger, and it is the library's, not ours.
- **Narrowed serializers.** `req` is serialised to `{ id, method, path }` and `res` to `{ statusCode }`. Headers, the body and the query string are therefore never serialised at all, so no credential or personal data can reach a log line (REVIEW.md §10.3). The query string is dropped rather than logged because an endpoint that one day takes a token or an email as a parameter would otherwise write it on every line. pino's `redact` option is deliberately **not** set: it can only mask paths that survive serialisation, and none do, so configuring it would read as an independent control while doing nothing.
- **Errors are logged as a whitelist, under an `error` key.** `serializeError` emits `{ type, message, stack, code }` and nothing else: `type`, `message` and `code` come from the **root of the cause chain**, walked to the end rather than one step, and `stack` is the outer stack reduced to the lines whose **shape** is a frame (`/^\s+at .*:\d+:\d+\)?$/`), so a bound value containing a newline and `at ` cannot pose as one. `message` is never trusted even after the walk: the statement text and bound values are collected from `query` and `params` at **every** level of the chain, and a root message repeating any of them is replaced outright with `database query failed`, because a repository that interpolates a driver message into its own sits between the handler's error and the statement and marks nothing with a field. Any other message is cut at the first quoted value and bounded, because driver messages quote what the caller sent (`invalid input syntax for type uuid: "..."`) (commit `c6e4ff2`). The shape it is written against is concrete and versioned rather than imagined: `drizzle-orm` 0.45 builds `DrizzleQueryError`'s message as `` `Failed query: ${query}\nparams: ${params}` ``, keeps `query` and `params` as own fields, and puts the driver error — which names the constraint and carries the SQLSTATE, but not the values — on `cause`. So the earlier, wider whitelist still leaked: pino's own serializer writes all of those fields, the message is the statement plus the bound row, and the first line of a stack repeats the message. Taking the message from the cause, and dropping the whole message from the stack, is what actually closes it. The message is removed by **counting its lines** — `stack.split('\n').slice(message.split('\n').length)` — never by matching them: `DrizzleQueryError`'s message is two lines (`Failed query: ...` then `params: ...`), so dropping only the first would leave the bound row on the record, and matching the message's own text against the stack would mean matching attacker-shaped input. What survives the count is then kept only if it has a frame's shape. That reasoning was carried by a comment in `src/shared/http/logger.ts` until commit `87b0a49` moved it here (REVIEW.md §12.3).
- **The error is never handed to a logger as an object.** The `error` key is used rather than pino's conventional `err`, and `serializeError` is called explicitly at each log site, because pino-http wraps a custom `err` serializer around pino's own: the same function would receive an already-flattened object through `req.log` and a real `Error` through the root logger. Left that way it silently turned every 500 line into `{"type":"object"}` with no message, no stack and no SQLSTATE. REVIEW.md §8.4 now requires this form. A thrown non-`Error` logs `{ type: typeof err }` — its type, never its value, which may itself be the leak. A dependency upgrade can change the driver's shape, so `tests/unit/shared/http/error-handler.test.ts` builds its fixture from the real `DrizzleQueryError` rather than a lookalike.
- **`serializeError` is exported** so the event and ingestion workers log through the same whitelist rather than a second copy of the rule.

**Bounded gap, tracked as [#41](https://github.com/mfozmen/promotion-management-api/issues/41).** The message guard is a prose heuristic where the error is not a wrapper: an error carrying `query` or `params` is replaced outright, but a bare `pg` `DatabaseError` carries neither, and some of its messages quote the caller's value in a form the `: "` cut does not catch — `value "99999999999" is out of range for type integer`. The exit is to stop reading prose: a `pg` error is identifiable by a five-character SQLSTATE and a `severity`, and for those the SQLSTATE and the constraint name are the whole diagnosis, so the message can be dropped rather than trimmed. That is deliberately not built here: no route on this branch touches the database, and inventing the error shape instead of reading it off a real driver is the mistake that cost this PR two review rounds already. The promotion PR owns it, against real `pg` errors. REVIEW.md §8.4 states this as a general rule — one shared implementation, called at every logging site, logged under an `error` key — so a second copy is itself a finding.

- **The error handler does not depend on being mounted behind `httpLogger`.** `errorHandler` reads `req.log ?? logger`. Mounted alone — in a sub-app, a worker's admin server, a test helper — it would otherwise throw a `TypeError` while handling an error, Express's final handler would take over and print the raw stack to stderr, and that is the leak the whitelist exists to prevent. The fallback is a contract of the file rather than a convenience, and `tests/unit/shared/http/error-handler.test.ts` mounts the handler without `httpLogger` to hold it (commit `ccef8a4`).
- **Injectable.** `createApp(logger?)` takes a logger, so tests capture lines instead of asserting on stdout.
- **No `console`.** `src/server.ts` writes its startup line through the root logger, so every line the process emits is JSON with the same fields.

### Consequences

- Every line is JSON carrying `reqId`, so a grep on one id returns the whole request — provided the id is unique, which is the caller's responsibility once it supplies one (see trade-offs).
- The error handler logs at `warn` for a mapped client error and at `error` with the stack for an unexpected throw, which makes "real 500s" a distinct, alertable signal rather than noise mixed with client mistakes.
- The id is the join key the queue boundary will have to carry: an event payload must propagate it so a worker's lines attach to the request that caused them. That propagation is **not implemented yet** — it lands with the first event producer.

### Trade-offs

- Narrow serializers mean a diagnosis that needs a request header or query string has to reproduce the request rather than read it back from logs. Accepted: the alternative failure (a credential or a customer's data sitting in a retained log) is not recoverable.
- A generated uuid is used whenever the incoming header is malformed, so a caller that sends a non-conforming id loses its own trace key. Accepted: the response header returns the id actually used, so the caller can still join.
- **A caller-supplied id is accepted, not verified to be unique.** `storefront` matches the safe-token pattern, so a CDN or a load generator that sends one constant `x-request-id` collapses a whole fleet's traffic onto a single `reqId` and the join key is worth nothing for those requests. Accepted, because issue #6 requires the caller's id to be echoed and honoured, and a caller that reuses one has given up its own trace; requests with a generated id are unaffected. If this ever bites, the fix is to log the caller's value as a separate `clientRequestId` and always generate `reqId`.
- **`SAFE_REQUEST_ID` will have to guard the queue boundary too.** A correlation id arriving in a BullMQ job payload is exactly as untrusted as one arriving in a header. The first event producer exports the pattern from `src/shared/http/logger.ts` and re-uses it rather than writing a second copy — a duplicated validation rule is the same failure mode REVIEW.md §1.3 rejects for the discount formula.
- pino writes JSON to stdout with no rotation or shipping; that is the container runtime's job. What is not its job is the buffer in between: pino's default destination is asynchronous with no maximum length, so a collector that stops draining the pipe turns every pending line into heap, and the process dies of memory rather than of anything it logged. The container story sizes the heap and sets a batching `minLength` on the destination, which also removes one write syscall per line under load.
- The `x-request-id` echo tells a caller the id exists. It is a uuid with no embedded information.

### Rejected alternatives

- `morgan`: text lines, no structured fields, no per-request child logger.
- Trusting `x-request-id` verbatim: log forging and response-header injection from an unauthenticated header.
- `redact` alone instead of narrow serializers: it protects only the paths named on the root logger and still serialises the rest of the headers, the query string and the body. It was briefly kept beside them until the advisory review on PR #30 pointed out that it can only mask paths the serializer has already removed.
- `AsyncLocalStorage` for ambient context: `req.log` covers the HTTP path; the store earns its place when the worker path needs the same id without a request object.
