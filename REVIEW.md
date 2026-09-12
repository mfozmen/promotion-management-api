# Review rules

Rules every review of this repository must enforce: the advisory Claude
review on pull requests, the local `impact-analyzer`, `e2e-tester` and
`architecture-critic` agents, and the human owner. They come on top of the
usual correctness and quality checks. Each rule states its severity; a
**blocking** finding must be fixed before the PR is handed to the owner.

The design these rules protect is in
`docs/superpowers/specs/2026-09-12-domain-design.md` and `ADR.md`. When a
change contradicts a decision there, the review says so and the PR either
follows the decision or updates the ADR in the same PR.

## 1. Money and time are exact

**Severity: critical. Blocking.**

- Prices are integer minor units (`*Cents`), percentages are basis points.
  No `number` arithmetic on decimal prices, no `parseFloat`, no `toFixed`
  for money. Vendor decimals are parsed to cents with string arithmetic.
- Effective price comes from the one pure function in the pricing module.
  A second implementation of the discount formula anywhere is a finding.
- Timestamps are `timestamptz` compared in UTC; validity windows are
  half-open `[startsAt, endsAt)`. A `<=` on `endsAt` or a local-time
  comparison is a finding.

## 2. Invariants live in the database, not in application checks

**Severity: critical. Blocking.**

- "At most one active promotion per target" is enforced by the two
  exclusion constraints. Code that pre-checks for overlap and then inserts
  (read-then-write) is a race and a finding, even if a constraint also
  exists; the constraint is the check, the handler maps `23P01` to `409`.
- SKU uniqueness and idempotent ingestion rely on `INSERT ... ON CONFLICT`.
  A `SELECT` followed by `INSERT` or `UPDATE` is a finding.
- Concurrency claims must be provable by a test that runs the operations in
  parallel and asserts the invariant afterwards. "Should be fine" is not a
  test.

## 3. Race conditions and ordering

**Severity: critical. Blocking.**

Review every path that touches shared state for interleavings:

- Two writers on the same product, category, job or chunk.
- A cancel racing a read, an assign racing an expiry, an ingestion batch
  racing a flash sale.
- Event handlers running twice (BullMQ is at-least-once): every handler must
  be idempotent and must recompute from PostgreSQL, never apply a delta.
- Category events are processed serially: the design runs one event-handler
  instance with concurrency 1 (per-category locks are the named upgrade).
  A change that lets two handlers for the same category run concurrently
  without such a lock is a finding.
- A category recompute writes each keyset batch in one pipeline. The short
  window in which pages mix old and new prices is accepted in ADR-0006; a
  recompute that can stop half-way without being retried or repaired, or
  one that writes products one round trip at a time, is a finding.
- Chunk checkpoints are compare-and-set (`where next_offset = $seen`) and
  the lease is renewed only by its holder. A plain `UPDATE` of a checkpoint
  is a finding.

## 4. Serverless constraints on the ingestion path

**Severity: critical. Blocking.**

- Nothing reads a whole vendor file: no `readFile`, no `JSON.parse` of a
  body, no `Promise.all` over all rows, no accumulating array across
  batches. Memory per invocation is bounded by one batch.
- Every unit of work has a time budget, stops when it is spent, and leaves
  a durable checkpoint before returning. Work that continues after the
  response is written (unawaited promises, timers) is a finding.
- Re-enqueueing the continuation happens before the response, and the
  worker must survive a kill at any line without duplicating rows on
  resume. The kill/resume integration test is required for any change to
  the chunk processor.
- Byte offsets are advanced by `Buffer` lengths, never by string lengths.

## 5. The storefront never reads PostgreSQL

**Severity: warning. Blocking on the two storefront routes.**

- `GET /api/products` and `GET /api/products/:id` read Redis only. A
  PostgreSQL query on those code paths, including a "fallback", is a
  finding; the designed behaviour on a missing read model is `503` until
  `readmodel:ready`.
- Read-model keys, ZSET scores and hash fields match the spec. A new field
  in the hash without a matching rebuild path is a finding.
- No `FLUSHALL`/`FLUSHDB` anywhere. Rebuilds `SCAN` + `UNLINK` by prefix on
  the read-model database only; the queue database is never touched by
  maintenance code.

## 6. High-traffic hygiene

**Severity: warning.**

- No N+1: a listing page issues one `ZRANGE` and one pipelined `HGETALL`
  batch, not one round trip per product. Any loop that awaits a Redis or
  PostgreSQL call per item is a finding.
- No unbounded queries: every list has a `LIMIT`; page size is capped.
- No synchronous CPU work proportional to catalogue size inside a request
  handler (a category recompute belongs to the worker).
- Hot paths do not allocate per request what can be allocated once
  (compiled schemas, prepared statements, Redis clients).
- Any change to a hot path is measured by the `e2e-tester` load run and
  the numbers are in the PR.

## 7. TDD and coverage

**Severity: warning. Blocking when coverage would drop.**

- The failing test exists before the implementation; the PR's commit order
  or test names should make this visible.
- Coverage stays at 100 % on statements, branches, functions and lines.
  `/* v8 ignore */`, `/* istanbul ignore */` and new entries in the
  coverage `exclude` list are findings unless the owner approved them in
  the PR discussion; only process entry points (`server.ts`, worker
  `main` files, CLI drivers) are excluded.
- Tests assert behaviour, not implementation: status codes, bodies, rows,
  Redis state, emitted events. A test that only checks a mock was called is
  a finding.
- Determinism: fixed clocks (`vi.useFakeTimers` or an injected `now`),
  fixed fixtures, no random data, no sleeps to "wait for" a worker. Poll a
  condition with a timeout instead.
- Integration tests run against real PostgreSQL and Redis; mocking the
  database or the queue in an integration test is a finding.

## 8. Errors and boundaries

**Severity: warning.**

- Every request body, query and path parameter is validated with zod at
  the boundary; handlers receive typed values only.
- Errors are `{ error: { code, message, details? } }` with the right
  status: `400` validation, `404` missing, `409` conflict, `429`
  backpressure, `503` read model not ready.
- Event handlers log and rethrow; a swallowed error (`catch {}`) is a
  finding. Rejected ingestion rows are counted and logged with their byte
  offset, never thrown.
- Secrets never reach logs, responses or error messages.

## 9. Keep it small

**Severity: suggestion.**

- No abstraction with one implementation, no configuration for a value
  that never changes, no feature the case does not ask for. Prefer deleting.
- Deliberate shortcuts carry a `// ponytail:` comment naming the ceiling and
  the upgrade path.
- A PR does one story. Scope creep is a finding; open another issue.

## 10. Repository hygiene

**Severity: critical for secrets and identities. Blocking.**

- No credentials in tracked files; `.env.example` holds placeholders only.
  A committed secret is flagged and rotated, not just removed.
- This repository is public: no real customer data, no personal data in
  fixtures or seeds, no internal hostnames or ticket references from any
  employer. Synthesize everything.
- English only in code, comments, docs, commits and PR text.
- Conventional Commit PR titles; the PR body carries the Case coverage
  table and lists which `.claude/agents/*.md` definitions were updated when
  the change adds an endpoint, job, cache or store.
- An architectural change without a matching `ADR.md` update is a finding.
