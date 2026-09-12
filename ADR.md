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
- Emission after commit is a rule (REVIEW.md 3.4) carried by review, not by code. A runtime guard existed briefly, an `AsyncLocalStorage` scope in which `enqueue()` and `removePromotionBoundaries()` threw, and it was deleted in issue #7: nothing ever entered the scope, so the assertion could not fire on any input, and a guard that cannot fire is worse than none because the next reader trusts it. It returns with its first real caller, the database module's `transaction()` helper wrapping its own body, which is issue #10 (the product create endpoint); issue #52 was closed as not planned in the 2026-09-12 issue cleanup and folded into it.
- Event payloads are validated on both sides of the boundary against the same schemas. The producer parses inside `enqueue()`, so a malformed job fails in the request that created it instead of in a worker three retries later; the consumer parses on receipt, because a delayed job can predate the schema the worker now holds. Only the producer half exists today, and the consumer half is the contract the event-handler PR has to honour. Issue #47 was closed as not planned: this is a recorded trade-off, not separately tracked work.
- Correlation-id transport across the queue boundary (REVIEW.md 10.1) is undecided: payloads are strict, so an id has to be added to the event schemas, and that decision belongs with the PR that introduces the logger.

### Trade-offs

- Eventual consistency instead of read-your-writes on the storefront. Accepted because the storefront is a catalogue, not a checkout.
- Two stores and a queue to operate instead of one database. Accepted because the case grades the structural answer to flash-sale load, and the safety net (ADR-0007) covers drift.
- Event schemas evolve additively and optionally while a delayed job can be in flight, and that window is the longest promotion window, because a promotion boundary is a delayed job. A payload written before a required field was added fails its `strictObject` parse on consumption, burns its three attempts and lands in the dead-letter set: safe, since the reconciler's boundary sweep still expires the promotion, but silent, since nothing says why. That safety depends on the consumer parsing, which no code does yet, so until the handler lands the real outcome is a handler reading an absent field. Recorded here rather than tracked separately, which is why issue #47 was closed as not planned.
- Queue operations are bounded at 2 s rather than left to ioredis, which reconnects for ever while BullMQ's `add` waits on it. An unreachable Redis therefore fails the admin request after its PostgreSQL commit instead of hanging it. The bound is a race that cancels nothing, so a timed-out operation may still land: it buys a fast failure, not a known outcome, and the reconciler reconciles either way — except after a cancel, which the boundary sweep specified in section 9 of the domain design need not catch: it re-emits for `starts_at`/`ends_at` in the watermark window, and a cancelled promotion need have neither in it, in which case the stale hash waits for the sampled price check instead, one reconciler period plus sampling. Sweeping `cancelled_at` in the same window, which section 9 now asks for, is the reconciler pull request's job. Closing the queues does not drain in-flight operations either, so shutdown stops producers first and bounds the wait: `SHUTDOWN_TIMEOUT_MS` (10 s) caps how long `server.close` may wait for open connections before the queues are closed and the exit is taken anyway, because one long request would otherwise hold the process until the orchestrator sends `SIGKILL`. The forced path is the enqueue-after-commit window under another name: a request that commits just before the cap has its `enqueue` torn out from under it, leaving the read model stale until the reconciler's sweep, exactly as a crash between the commit and the enqueue would. Connecting has its own budget, `QUEUE_CONNECT_TIMEOUT_MS` (10 s), because a managed `rediss://` instance pays DNS and a TLS handshake once and 2 s is not generous for that, while 2 s is the right bound for an operation on a connection that is already open. A queue-unavailable failure is not yet distinguishable from any other 5xx by a metric; that arrives with the logging and metrics story, issue #18, into which issue #53 was folded. The alternative, giving up reconnection so the command fails on its own, would leave a long-lived producer permanently disconnected after one blip.
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

Promotions are rows, not rules: `discount_type` of `percentage` or `fixed`, `value` in basis points or minor units, `starts_at`, `ends_at`, exactly one of `product_id` or `category` once active, and a `status` of `draft`, `active` or `cancelled` (a draft has no target; a cancelled row keeps the shape it had). The enum is the case's own vocabulary, and a third kind of discount is a migration that widens it — the right cost, because a vocabulary a reader can enumerate is worth more than one that can hold anything. Two PostgreSQL exclusion constraints (`btree_gist`, `tstzrange(starts_at, ends_at) &&`) guarantee at most one active product-level promotion per product and at most one active category-level promotion per category at any instant. Overlap at the same level fails with `409` and reports the conflicting promotion; there is no silent override.

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
- Cancel can see the race it lost: `removePromotionBoundaries` returns BullMQ's removal code per boundary, where `0` means a worker already holds that job and `1` means nothing blocked the removal, including when there was no such job. The caller can log the `0`; the end state is still correct because cancel also enqueues an immediate `promotion.changed` and the event handler runs at concurrency 1, so the cancel recompute cannot overtake the activate recompute (commit `829d6bb`).
- The boundary delay is computed from an injected clock rather than `new Date()`, so the caller decides. It must pass PostgreSQL's `now()`: on application clock drift an activate fires before its window opens, the handler finds the promotion not yet active, and the base price stands until the reconciler's boundary sweep corrects it (REVIEW.md 1.6, 1.7).

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
- Reporting the conflicting promotion needs a second `SELECT` after SQLSTATE 23P01; acceptable on an admin path.

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

- Any single failure (worker crash, lost event, expired lease, Redis restart) converges without operator action within one reconciler period, with the one exception ADR-0003 states: a lost `promotion.changed` for a cancel can fall outside the boundary sweep, and then converges by sampling instead.
- Operators have a small, orthogonal set of levers: stop intake, stop consumption, retry or discard failures, rebuild a scope.
- The read-model and queue databases are separate, so no maintenance action can destroy queued work.

### Trade-offs

- The promotion boundary sweep runs from a persisted watermark (`reconciler_state.last_boundary_sweep_at`), so an outage of any length is caught up on the first run back, at the cost of one extra row and one write per run.
- BullMQ ignores an `add` for a job id it still holds, and `removeOnComplete: 1000` is a count rather than a duration, so whether a fired boundary job is still resident depends on the completion rate. Nothing is allowed to depend on the answer: the reconciler's sweep re-emits `promotion.changed` with no job id, and the deterministic `promo:{id}:{activate,expire}` ids are used only to schedule and to cancel a future boundary (commit `829d6bb`). Write-once also means boundaries are immutable after assign: a branch that lets `starts_at` or `ends_at` be edited has to remove the jobs before re-scheduling, or the old boundary fires and the new one is dropped. The two colons in that id are load-bearing: bullmq 6.3.4 rejects a custom job id containing a colon unless it splits into exactly three parts, a compatibility carve-out its own source marks for removal in the next breaking change, so `promo:{id}:{boundary}` passes by arithmetic rather than by a documented API. A major upgrade that tightens it makes `enqueue` throw after the promotion has already committed; the escape is `promo-{id}-{boundary}`, and the integration test asserting the literal id is what catches the upgrade rather than production.
- The dead-letter set is deliberately unbounded (`removeOnFail: false`): a poisoned job must survive its retries and stay inspectable. The bound is operational rather than structural — the Grafana "any failed job" alert fires on the first one and `POST /api/admin/dlq/retry` or `discard` drains it — so a failure that retries thousands of jobs, such as PostgreSQL being unavailable through a 500 000-row import, grows Redis until an operator acts. Both stores share an instance, so that pressure reaches the read model even though the logical databases are separate.
- The price check in the reconciler is sampled (`max(50, 1 %)` of a category per run, capped at 500), so a single wrong price can survive a run; the exact count comparison and the resampling on every run bound that exposure to minutes, and the manual rebuild remains the override.
- A five-minute reconciler period is the worst-case repair time for a lost event. Shorter periods cost PostgreSQL reads; the sampled check keeps each run cheap.
- A drain deletes waiting work; it requires an explicit confirmation parameter.
- Alerting lives in Grafana rules rather than application code, so thresholds can be tuned without a deploy but are not unit-tested; the metrics that feed them are.

### Rejected alternatives

- Full rebuild on any drift: unnecessary load; scoped rebuilds are sufficient.
- `FLUSHDB` for rebuilds: would erase the queue when it shares the instance.
