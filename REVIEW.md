# Review rules

Rules every review of this repository enforces: the advisory Claude review on
pull requests, the local `impact-analyzer`, `e2e-tester` and
`architecture-critic` agents, and the human owner. They sit on top of ordinary
correctness and quality review, and they exist because this system is graded on
two scalability scenarios where the expensive mistakes are silent: a race that
shows up once a week, a loop that is fine at 100 rows and fatal at 500 000, a
test suite that is green because it never tried the boundary.

**How to use this document.** Each rule has a severity. **Blocking** findings
are fixed before a PR is handed to the owner. Cite the rule number in every
finding (`REVIEW.md §7.3`). When a rule and the code disagree, say which line
and why. When a rule and the design disagree, the design wins and the rule gets
fixed in the same PR.

**The design these rules protect** is
`docs/superpowers/specs/2026-09-12-domain-design.md` and `ADR.md`. A change that
contradicts a decision there either follows the decision or updates the ADR in
the same PR. Never both silently.

**Reviewer posture.** Assume the happy path works; the author tested it. Spend
your attention on the paths nobody ran: the second concurrent request, the retry
after the crash, the empty list, the 500 001st row, the promotion that expired
one millisecond ago. A finding that names a concrete trigger and its effect is
worth ten findings that say "consider".

**Be brief.** A finding is at most three sentences: what breaks, what triggers
it, what to do. Cite the rule number and the file and line instead of restating
the rule. No preamble, no summary of the diff, no praise for what is correct, no
repetition of a finding already on a resolved thread. The top-level summary is
one short paragraph plus the grouped findings; if a review reads like an essay
it is costing more attention than it returns. The same applies to replies on a
thread: say what changed and in which commit, and stop.

---

## 1. Money and time are exact

**Severity: critical. Blocking.**

1.1 Prices are integer minor units (`*Cents`, `bigint`), percentages are basis
points (`10000 = 100 %`). No `float`/`double` column, no `number` arithmetic on
a decimal price, no `parseFloat`, no `toFixed` to "fix" a rounding artefact.

1.2 Vendor decimals are parsed to cents by string manipulation, not by
`parseFloat(x) * 100`. In JavaScript `parseFloat("4.35") * 100` is
`434.99999999999994` and `parseFloat("1.10") * 100` is `110.00000000000001`;
a truncation turns the first into 434 cents. A parser that rounds its way out
of that is a finding, because the next input will find the case it misses.

1.3 Exactly one implementation of each discount formula exists, in the
`Discount` for that discount type (`src/modules/promotion/domain/`), reached
only through `EffectivePriceCalculator`. A second copy inline in a query, a worker or a
test fixture is a finding even when it agrees today.

1.4 Rounding direction is stated and tested: the discount is floored, so the
customer pays at most one cent more than the ideal. Any new rounding site
declares its direction.

1.5 Effective price is never negative and never above base price. A fixed
discount larger than the base clamps to zero; a percentage above 10 000 basis
points is rejected at the boundary, not clamped silently.

1.6 Timestamps are `timestamptz` and compared in UTC. Validity windows are
half-open `[startsAt, endsAt)`. A `<=` on `endsAt`, a `Date` compared with a
string, or a comparison against the Node process clock where the database clock
is authoritative, is a finding.

1.7 One clock. Application code does not compute "is active" from
`new Date()` while SQL computes it from `now()`; whichever is chosen is used
everywhere, and tests can inject it.

---

## 2. Invariants live in the database

**Severity: critical. Blocking.**

2.1 "At most one active promotion per target" is the two GiST exclusion
constraints. Code that queries for an overlap and then inserts is a
time-of-check-to-time-of-use race and a finding, even when a constraint also
exists. The constraint is the check; the handler maps SQLSTATE `23P01` to `409`.

2.2 SKU identity and ingestion idempotency are `INSERT ... ON CONFLICT`. A
`SELECT` followed by an `INSERT` or `UPDATE` on the same key is a finding.

2.3 State transitions carry their precondition in the `WHERE` clause and check
the affected-row count: `where id = $1 and status = 'draft' and ends_at > now()`.
Reading a row, deciding in JavaScript, then updating it by primary key is a lost
update and a finding.

2.4 Every constraint the design names exists in a migration: `NOT NULL`,
`CHECK`, `UNIQUE`, foreign keys, the partial unique index for one running job
per vendor. A rule enforced only in zod is a finding when the same rule protects
an invariant.

2.5 A concurrency claim in a comment or a PR description must have a test that
runs the operations in parallel and asserts the invariant afterwards. "Should be
fine" is not a test. Writing the test is also how the claim gets checked, not just
the code: the rule catches a wrong description as often as a wrong mechanism.

Evidence: a README said two concurrent demo seeds left the loser aborting on 23P01, and
the test this rule demanded showed neither run fails.

2.6 A `WHERE` clause on a nullable column states its `NULL` branch explicitly.
`NULL` compared with anything is `NULL`, not `TRUE`, and a row-value
comparison stops at the first pair it cannot decide: `(a, b) > (c, d)` is
`NULL` when `c` is `NULL`, and also when `a = c` and `d` is `NULL`, so a
guard such as `ON CONFLICT DO UPDATE ... WHERE (a, b) > (c, d)` silently
skips the row in both cases. The standard form names every nullable column:
`c IS NULL OR d IS NULL OR (a, b) > (c, d)`. When the schema guarantees the
columns are null together (as `ingest_job_id` and `ingest_source_offset` are:
both written by the same upsert), say so next to the guard and test the
all-null case; otherwise test each column null on its own.

2.7 State that depends on time or on other rows — "is this promotion active",
"which candidate applies" — is decided in SQL on the database clock, as a view
or the query's `WHERE`, never re-derived in code. A predicate that exists in
both a query and a function is a finding.

Evidence: `isActive(promotion, now)` duplicated the resolution query's
`tstzrange(...) @> now()` on a second clock (PR #29, issue #28).

---

## 2b. Business data lives in the database

**Severity: critical. Blocking.**

2b.1 Business data comes from the database at runtime, always. Pricing rules,
promotions, products, categories, thresholds an operator would ever want to
change: rows, read through a query, never a constant in a module.

Evidence: a pricing module shipped a `DEFAULT_PRICING_RULES` array that nothing
imported, written because the table it belonged in had not been built yet.

2b.2 A seed belongs with the migrations, not in the code that consumes it. A
`DEFAULT_*` array of rows inside a runtime module is a finding even when
nothing reads it: the bundle ships data it never uses, and the day the table
arrives the same rows exist in two places with nothing keeping them equal.

2b.3 Tests are the exception, and only tests. A test may build its own rows in
memory, but a story that owns a table also has one test that reads through the
real query against a real database, so the query is exercised at least once.

2b.4 Order the work so this is possible: the table and its migration land
before the code that reads it. A story written against a table that does not
exist yet has to invent a constant to stand in for it, and that constant then
has to be removed, re-tested and re-documented. Doing it in the wrong order
means doing it twice.

2b.5 What may be a constant in code: the instruction set, not the policy.
Zod schemas, enum members the database column already constrains, and physical
limits such as PostgreSQL's bind parameter ceiling. If an operator would ever
want to change it without a deploy, it is a row.

---

## 3. Concurrency and ordering

**Severity: critical. Blocking.**

Walk every path that touches shared state and ask what a second actor does
between any two lines.

3.1 **Two writers, same key.** Two admins assigning to one product, two assigns
of one draft, two chunk workers claiming one chunk, ingestion updating a price
while a flash sale recomputes it. Name the mechanism that serialises them:
constraint, lease, compare-and-set, or single-consumer ordering.

3.2 **At-least-once delivery.** Every event handler runs twice eventually.
Handlers recompute from PostgreSQL and write the whole result; they never apply
a delta (`ZINCRBY`, `counter = counter + 1`, "append to list"). A delta in a
handler is a finding.

3.3 **Out-of-order delivery.** Two events for the same entity can be processed
in either order. Recompute-from-truth makes order irrelevant; anything that
depends on order needs a version, a timestamp comparison, or a single consumer.
`ingest_source_offset` is the model: the later row in the file wins regardless of
which worker commits first.

3.4 **Enqueue after commit.** A job enqueued inside the transaction can be
consumed before the row is visible, and survives a rollback. Enqueue after the
commit returns, and rely on the reconciler for the crash-in-between window. The
reverse ordering is a finding.

3.5 **Dual-write.** PostgreSQL and Redis cannot be written atomically. Every
such pair states which store is authoritative, how the other converges, and the
bound on the window. A code path that treats "wrote to Redis" as success without
PostgreSQL having committed is a finding.

3.6 **Lease and checkpoint discipline.** A lease is renewed only by its holder.
A checkpoint moves only by compare-and-set (`where next_offset = $seen`). A
plain `UPDATE` of a checkpoint, or a claim whose `WHERE` does not exclude a live
lease, is a finding.

3.7 **Lock ordering.** Batched writes touching multiple rows sort their keys
(by SKU) so two concurrent batches cannot deadlock. A new multi-row write
without a deterministic order is a finding.

3.8 **Transaction scope.** No network call, no queue publish, no sleep, no
file read inside a transaction. Long transactions hold locks and exhaust the
pool. `SELECT FOR UPDATE` without `SKIP LOCKED` on a work-queue table is a
finding.

3.9 **Redis atomicity.** A read-then-write across two Redis commands is a race
unless one of the §3.1 mechanisms serialises the writers. The read-model writer
has four consumers, one per queue and three of them writers, so concurrency 1 is not
available to it: every
read-model write is a Lua compare-and-set on a `sourceReadAt` token, and a consumer that
writes without it is a finding. ADR-0003 states the clauses: which clock, how often it is
taken, what absence and a tie mean, and how much of the write the script owns. The rule
changed when the queues were partitioned by urgency and the guarantee that a
single consumer had been providing went with it, silently. Elsewhere use a single command, a pipeline that does not depend on
intermediate reads, `SET NX`, or a Lua script. `WATCH`/`MULTI` without a retry
loop is a finding.

3.10 **Timers are not schedulers.** Nothing relies on `setTimeout`,
`setInterval` or in-process state to make something happen later; the process
can die. Delayed queue jobs plus the reconciler's watermark sweep are the
mechanism.

3.11 **Graceful shutdown.** On `SIGTERM` a worker stops accepting jobs, finishes
or checkpoints the current batch, and exits. A handler that can be killed
mid-write without a durable checkpoint is a finding.

---

## 4. Serverless constraints on the ingestion path

**Severity: critical. Blocking.**

4.1 Nothing reads a whole file: no `readFile`, no `JSON.parse` of a whole body,
no `rows.push()` that accumulates across batches, no `Promise.all` over the
file's rows. Memory per invocation is bounded by one batch and the stream
buffers.

4.2 Every unit of work has a time budget, stops when it is spent, and leaves a
durable checkpoint before returning. Work that continues after the response is
written, an unawaited promise, or a `void somePromise()` is a finding.

4.3 The continuation is enqueued before the handler returns, and the handler
survives a kill at any line without duplicating rows on resume. Any change to
the chunk processor requires the kill-and-resume integration test to run.

4.4 Byte offsets advance by `Buffer` length, never by string length. Lines are
split on `0x0A` over raw buffers, with the trailing `0x0D` stripped, the BOM
handled at offset 0 only, and the header consumed only by chunk 0.

4.5 A batch is deduplicated by SKU before the multi-row upsert; two rows for one
key in a single `ON CONFLICT DO UPDATE` raise SQLSTATE `21000` and abort the
batch.

4.6 Rejected rows are counted and logged with their byte offset. A malformed row
never aborts the job; an exception that escapes the row loop is a finding.

4.7 Retry and failure counting are separate. A planned budget hand-off must not
consume the failure budget, or a large chunk fails for being large.

---

## 5. The read path

**Severity: critical on the storefront routes, warning elsewhere. Blocking.**

5.1 `GET /api/products` and `GET /api/products/:id` read Redis only. A
PostgreSQL query on those paths, including a "just a fallback", is a finding;
the designed behaviour when the read model is missing is `503` until
`readmodel:ready`.

5.2 Read-model keys, ZSET scores and hash fields match the spec exactly. A new
hash field without a corresponding rebuild path is a finding: the rebuild is
what makes the field true for the other 499 999 products.

5.3 No `FLUSHALL`/`FLUSHDB`. A rebuild deletes and rewrites each entry inside the
one script that writes it (ADR-0003's ordering clauses: a prefix delete takes the
ordering token with the entry, and absence of a token has to mean never written).
`SCAN` + `UNLINK` by prefix is for the orphans that remain — ids the write store
no longer has — on the
read-model database only. `KEYS` in any code path is a finding.

5.4 The queue database and the read-model database are separate logical
databases; no maintenance operation can reach the queue.

5.5 Pagination is bounded: page size has a hard cap, the cap is enforced server
side, and the sort is total — a tiebreaker column — so a single snapshot cannot
repeat or skip a row. Where the sort key can change under a reader, say so: the
storefront's ZSET scores are rewritten progressively while a category is
rescanned, so an offset page taken during a sale can repeat a row or miss one,
and the route states that window rather than claiming it cannot happen. The
cursor form (`ZRANGEBYSCORE` with an exclusive `(score, id)` cursor) is the
upgrade, and "within one version" is not a guarantee this design offers,
because it has no version.

5.6 A cache entry whose freshness depends on another key states how the two are
kept consistent. A key that can be written without its index (`HSET` without the
matching `ZADD`) is a finding.

5.7 The read model has no TTL and no database fallback by design; freshness
comes from events and the reconciler. A PR that introduces a TTL, a lazy
fill-on-miss, or any read-through path reintroduces stampedes and the
cancel-then-read race, and must bring the stampede lock and the ordering
argument with it.

5.8 **A Redis `ReplyError` is not proof of a permanent fault.** `-LOADING`,
`-OOM`, `-BUSY`, `-MISCONF` and `-READONLY` arrive in the same class as
`-WRONGTYPE`, so classify on the error string and let an unrecognised reply be
the retryable answer.

Evidence: classifying on the class answered a Redis restart with a 500 that
nothing retries.

---

## 6. Performance, especially in loops

**Severity: warning. Blocking on the storefront routes, the event handler and
the ingestion worker.**

The catalogue is 500 000 rows and a category is 50 000. Anything per-item that
crosses a process boundary is multiplied by those numbers.

6.1 **No `await` inside a `for` loop over a collection** when the calls are
independent. That is N sequential round trips. Batch them (`IN`, pipeline,
multi-row insert) or bound the parallelism explicitly.

6.2 **No `await` inside `forEach`.** `forEach` ignores the returned promise: the
loop finishes before the work does, errors vanish, and the handler reports
success. Always a finding.

6.3 **No unbounded `Promise.all`** over a collection whose size grows with the
data. 50 000 concurrent queries exhaust the connection pool and the heap. Use a
fixed concurrency limit or chunk the work.

6.4 **No query inside a loop.** One query per product in a listing is the N+1
that the read model exists to prevent. The same applies to Redis: one `HGETALL`
per id must be one pipeline, not 100 round trips.

6.5 **No O(n²) lookups.** `array.find`/`includes`/`indexOf` inside a loop over
another array is quadratic; build a `Map` or `Set` once. Spreading an
accumulator in `reduce` (`{...acc, [k]: v}`) copies the whole object per
iteration and is quadratic in memory traffic.

6.6 **No per-iteration allocation of reusable things**: a compiled schema, a
regular expression, a database client, a `new Intl.NumberFormat`, a logger
child. Build once outside the loop.

6.7 **No logging inside a hot loop.** One I/O call per row at 500 000 rows is
its own outage. Log per batch, with counts.

6.8 **Queries are bounded and narrow.** Every list has a `LIMIT`; `SELECT *`
where three columns are used is a finding on hot paths. Indexing rules are in 6.12 to 6.15.

6.9 **No deep offset paging in worker scans.** Keyset pagination
(`where id > $last order by id limit n`) for anything that walks a category or
the catalogue; `OFFSET 400000` reads 400 000 rows to discard them.

6.10 **No whole-result-set materialisation** where a cursor, a stream or a
batched loop would do, and no `IN` list built from an unbounded array
(parameter limits and plan blowups).

6.11 **Synchronous CPU work proportional to catalogue size never runs inside a
request handler.** That belongs to a worker; the request enqueues.

**Database and Redis.** The write store holds 500 000 products and grows
weekly; every query shape is reviewed as if it ran against that table.

6.12 **Every new query shape arrives with its plan.** A PR that adds or changes
a query against `products`, `promotions`, `ingestion_chunks` or any table that
grows includes the `EXPLAIN (ANALYZE, BUFFERS)` output against a seeded
database of realistic size (the 500 000-row fixture), and the plan uses an
index. A sequential scan on a growing table in a request handler or a worker
loop is a finding.

6.13 **The index matches the query, column order included.** A composite index
serves `WHERE a = ? AND b > ? ORDER BY b` only as `(a, b)`. An index that
exists but cannot be used by the query it was added for is a finding. Partial
indexes carry the same predicate the query uses (`where status = 'active'`).

6.14 **Predicates are sargable.** No function on an indexed column in `WHERE`
(`lower(sku)`, `date(created_at)`, `starts_at::date`), no leading-wildcard
`LIKE`, no `NOT IN` on a large list, no `OR` across different columns where a
`UNION` or a redesign would index. Compare `tstzrange(starts_at, ends_at) @>
now()` against the GiST index that exists for it; a `starts_at <= now() and
now() < ends_at` pair only uses a btree.

6.15 **Every foreign key and every join or filter column has an index**, and
every index earns its write cost. An index added "just in case" on a hot write
table (`products` during ingestion) is a finding; say which query uses it.

6.16 **Bulk writes are batched, not row-by-row, and not one giant statement.**
Ingestion upserts in multi-row statements of about 1 000 rows inside one
transaction per batch. A single `INSERT` per row is a round trip per row; a
single statement for 40 000 rows holds locks and blows the parameter limit.

6.17 **Mass updates create dead tuples.** A weekly upsert of 500 000 rows leaves
500 000 dead versions until autovacuum runs. A PR that touches ingestion states
whether autovacuum defaults are adequate for the tables it writes, and a
recompute that rewrites a row whose values did not change is a finding
(`ON CONFLICT DO UPDATE ... WHERE excluded.x IS DISTINCT FROM products.x`).

6.18 **Use `RETURNING`** instead of a write followed by a read. A
`SELECT` to fetch what an `INSERT` or `UPDATE` just wrote is a round trip and a
race.

6.19 **Connection and statement limits are explicit.** One pool per process,
sized below the server's `max_connections` divided by the number of processes;
a `statement_timeout` on every pool; `idle_in_transaction_session_timeout` set.
A worker that opens a connection per job, or a pool without a timeout, is a
finding.

6.20 **Hot-row contention is named.** A single row every writer updates
(`ingestion_jobs.chunks_done`, `reconciler_state`) serialises those writers;
state the write rate and why it is acceptable, or move the count to a query.

6.21 **Redis memory and command cost are bounded.** A hash per product times
500 000 products is the read model's footprint; a new field is multiplied by
that. `ZRANGE` with `LIMIT offset count` is O(log N + offset + M), **not**
O(log N + M): Redis walks and discards `offset` members before it returns
anything, so a page number large enough makes one unauthenticated request
scan the whole set on a single-threaded server. A page size cap bounds the
fan-out and not that scan, so an offset bound is its own rule: cap it, and
name a keyset cursor on `(score, member)` as the upgrade when something has to
walk further. A `ZRANGE` without `LIMIT`, an `SMEMBERS` on a large set, or an
`HGETALL` on an unbounded hash is a finding. Big pipelines are chunked (about
1 000 commands) so one reply does not buffer the whole category.

Evidence: this rule stated the cost without the `offset` term, and the
storefront listing shipped an unbounded `page` past a review that read the
rule and agreed with it. The wrong half was the half a reviewer
would lean on.

6.22 **Measure what you claim.** Any change to a storefront route, the event
handler or the chunk processor reports the `e2e-tester` numbers in the PR:
requests per second, p50, p99, peak RSS. "Should be faster" without a number is
a finding. A PR with no run yet names the numbers it is
waiting on; what this forbids is a performance claim with no number behind it.

---

## 7. Tests, and the edge cases that matter

**Severity: warning. Blocking when coverage drops or an edge case in 7.4 is
missing for the code it touches.**

7.1 **Test first.** The failing test exists before the implementation; commit
order or test names should show it.

7.2 **Coverage stays at 100 %** on statements, branches, functions and lines.
`/* v8 ignore */`, `/* istanbul ignore */` and new `exclude` entries are
findings unless the owner approved them in the PR; only process entry points
(`server.ts`, worker mains, CLI drivers) are excluded. 100 % line coverage with
no edge-case assertions is worse than 90 % with them, so 7.4 is the real bar.

7.3 **Tests assert behaviour**: status codes, response bodies, database rows,
Redis contents, emitted jobs. A test whose only assertion is that a mock was
called is a finding. Integration tests run against real PostgreSQL and Redis;
mocking either in an integration test is a finding.

7.4 **Edge-case catalogue.** For the code a PR touches, the matching cases must
exist. Missing ones are named in the review.

_Boundaries and time_

- Exactly at `startsAt`; exactly at `endsAt` (excluded); one millisecond either
  side. A promotion that expired between the read and the render.
- A scheduled promotion that starts in the future; one whose window already
  passed; `endsAt` before `startsAt` rejected.
- Clock moving across a day boundary and a DST change in the input timezone.

_Numbers and money_

- Zero base price; a fixed discount larger than the base; a 100 % percentage;
  a percentage above 100 rejected; a discount of zero rejected.
- Rounding: an odd cent, a price where the floor matters, the largest price the
  column allows.

_Collections and paging_

- Empty result; exactly one item; exactly one page; page size plus one; the last
  page; a page beyond the end; page size above the cap.
- Ties in the sort key, so the tiebreaker is proven.

_Strings and input_

- Unicode names (Turkish characters), leading and trailing whitespace, an empty
  string where a value is required, a very long value, an unknown field in the
  body, a wrong type, a missing body.

_Files_

- Empty file; header only; no trailing newline; CRLF; a UTF-8 BOM; a blank line
  in the middle; a quoted field containing a comma; a row with too few or too
  many columns; a duplicate SKU inside one batch and across two chunks.

_Promotions and inheritance_

- A product created in a category with an active promotion is discounted on
  its first read, with no extra event.
- A product carrying both a product-level and a category-level active promotion
  gets the lower of the two effective prices, in the customer's favour, and a
  higher-priority rule overrides that default. The test inserts the rule row it
  asserts against: a test that pinned the seeded production default would be
  asserting a configuration value, and a policy that lives in a row is not a
  policy a test may freeze.
- Cancelling the category promotion restores base price for every product that
  had no promotion of its own, and its own effective price for the rest — under
  lowest-price precedence the category promotion may have been the one applied,
  so "leaves the others untouched" would pin the retired policy.
- The **seeded** rules, read from the migrated database, select the lower price
  for a two-candidate product and the only candidate for a one-candidate one.
  That is a test of code: the seed is a migration row, changed by commit, and
  the test changes with it. What must not exist is a test pinning the row a
  _running_ database holds — an operator editing it changes neither code nor
  test, and that is what keeps the policy data rather than configuration
  frozen by CI.

_Concurrency_

- Two parallel writers on the same key, asserting exactly one winner and the
  invariant afterwards.
- The same event delivered twice, asserting the end state is identical.
- A write racing a read, asserting the read never sees a torn value.

_Failure_

- Kill the worker mid-batch and resume: exact row count, no duplicates.
- Redis unavailable; PostgreSQL unavailable; the queue unavailable. Each has a
  defined response, and the test asserts it.
- A poisoned job reaching the dead-letter set after its retries.

7.4b **A control is proved only in the configuration production runs.** A test
that exercises a safety control sets the level, the environment variable and
the framework default explicitly instead of inheriting whatever the harness
uses. If the control depends on a log level, build the logger at that level in
the test; if it depends on `NODE_ENV`, set it.

Evidence: twice in one pull request a control passed review while never firing
in production. Express prints a raw stack on every environment except `test`,
which is the one the suite runs in, and a compensating `debug` log line sat
under a root logger running at `info` while the capture logger in the test ran
at `trace`. A third time, a test asserted the assignment a shallow `Object.freeze`
does stop and never the one it does not: the rows inside the frozen table stayed
writable, and a row's fields are what the response is built from. Assert the
reachable breach, not the one the control obviously covers.

7.5 **Determinism.** Fixed clocks (injected `now` or fake timers), fixed
fixtures, no random data, no `sleep` to wait for a worker. Poll a condition with
a timeout. A flaky test is a finding, not a retry.

7.6 **Isolation.** Each test file owns its data; tests pass in any order and in
parallel. Shared mutable fixtures across files are a finding.

7.7 **Layout.** `tests/unit`, `tests/integration`, `tests/e2e`; inside a layer
the tree mirrors `src/`, one test file per source file, with the same name
(`x.ts` → `x.test.ts`) and the export's name as the top-level `describe`.
No per-module top-level directories. A test of a tree-wide property with no
source file (`migration-journal.test.ts`) is named for the property, at the path
of what it guards. The one thing at `tests/` root is a helper both layers need:
`app-deps.ts` builds the dependency set `createApp` requires, and a copy per
layer would be two spellings of one contract. ADR-0008.

7.8 **A test imports its subject through the `@src/*` alias, production code
never does.** `import { EffectivePriceCalculator } from '@src/modules/promotion/domain/effective-price-calculator.js'`
in a test; a relative specifier in `src/`. The alias is `paths` in
`tsconfig.json` plus `resolve.alias` in `vitest.config.ts`, and an ESLint
`no-restricted-imports` rule scoped to `src/**` enforces the second half,
because a convention nothing checks is not one.

The asymmetry is not taste. `tsc` does not rewrite a path alias on emit, so
`@src/...` inside `src/` compiles, builds, passes every unit test and then
throws `ERR_MODULE_NOT_FOUND` at container start — the one place nothing is
watching. Tests are excluded from `tsconfig.build.json` and never emitted, so
the alias cannot reach a running process through them.

A vitest workspace project does not inherit the root config's `resolve` block.
Declare the alias once and spread it into every project, or the aliased imports
resolve in `npm test` and fail in whichever project forgot it.

Evidence: five levels of `../` in a test that had moved four times in one
evening (PR #29); then eleven test files red at once when the alias met a
workspace whose projects did not carry it (PR #50).

7.9 **A test that fakes a dependency's failure asserts the shape that
dependency actually produces.** Run the failure against the real library once
and build the double from what comes back, because the failing shape is the one
nobody looks at.

Evidence: `pipeline.exec()` resolves with `[[Error, null]]` rather than
rejecting, so a double that rejected proved a branch ioredis never reaches.

7.10 **When you relax a validator, name what it was detecting and say where
that detection now lives.** A strict rule is often doing two jobs, and relaxing
it for the first silently spends the second.

Evidence: reading `''` as "no promotion" retired the check that a discounted
price names its promotion, and nothing failed.

---

## 8. Boundaries, errors and API shape

**Severity: warning.**

8.1 Every body, query parameter and path parameter is validated with zod at the
boundary; handlers receive parsed, typed values. Unknown fields are rejected
rather than ignored, so a typo in a client is visible.

8.2 Numeric query parameters are validated as integers with bounds. `page=-1`,
`page=1e9`, `pageSize=99999` and `page=abc` each have a defined answer.

8.3 Errors are `{ error: { message } }` with the right status: `400`
validation, `404` missing, `409` conflict, `429` backpressure, `503` read model
not ready. The status is the taxonomy a client branches on; the message is for a
human, and it is the whole body: no code, no field-level breakdown (ADR-0009).

8.3b A response may name where a problem is and which of the caller's own
fields or identifiers it concerns. It never reproduces a stored value, and it
never repeats a free-form value the caller sent: a value is not an identifier
and there is nothing to fix by seeing it again, so a 404 does not echo the path.

This binds every message that reaches a response, not only the ones a
middleware writes. A handler's own 4xx message crosses as written, unbounded and
uninspected, so a message naming a row the caller never saw is a finding wherever
it was built. A schema's message is the same case one layer down — a custom or
refinement message must not interpolate the value it rejected — though under the
current envelope a schema's message reaches nobody, so the message a caller reads
is the one the handler passed to `createError`.

There is no carve-out. This rule used to grant one: the overlap `409` returned
`details.conflictingPromotionId`, argued as a bounded exception because an admin
refused a promotion "cannot act without knowing which one to cancel". They can —
the two exclusion constraints are keyed on product and on category, so the filter
that finds the blocker is one the admin already has. The exception cost a query
on every conflict whose result was discarded, and it made this rule cite itself
as its own exception. What it bought was skipping a window comparison across a
few rows. The honest price of removing it is that comparison, not a blocked task.

Evidence: `conflicts with promotion "Summer Sale" (id 7, 50 %)` hands the caller
another row's fields, which they never had. The carve-out was removed when the
envelope lost `details`: the code that cited this rule as forbidding the id sat
beside a rule mandating it, and the next author would have added it back,
correctly, per the rulebook.

8.4 No internal detail escapes to the client: no stack trace, no SQL text, no
connection string, no secret, in a response. A log line is read by the operator,
not the caller, so the stack of an unexpected error belongs there — it is the
only way to diagnose a 500 — and never in the body. An error is logged under
`err`, where pino's own serializer shapes it; a hand-written whitelist beside
it is a finding (12.9).

A 5xx marked `expose: true` returns its message, so a host, a port, a statement
or a credential in one is a finding at the raise site: the library masks the
forgetful raiser and nothing masks the deliberate one.

8.5 Handlers log and rethrow; `catch {}` is a finding. A caught error that is
neither logged nor rethrown is a silent failure.

8.6 Request body size is capped, and the cap is smaller than what would exhaust
memory on the smallest configured container.

---

## 8b. Comments

**Severity: critical. Blocking.**

Raised from warning on 2026-09-13: as a warning it was skipped twice in one
day — a 293-line module reached hand-off at 33 per cent narrative comment lines
with every check green. The owner's rule is that a clear function carries no
comment, so a violation blocks like any other.

8b.1 A comment earns its line by saying something the code cannot: a
non-obvious invariant, a unit that is not in the name, a reason the obvious
approach was rejected, a shortcut's ceiling, a contract a caller must honour.

8b.1a The test is the reader, not the writer. Code a reader understands on
its own carries no comment. Code a reader cannot understand without help
carries one comment, simpler than the code it explains — one sentence, plain
words. A comment that is harder to read than the code, or that a reader has to
parse twice, is a finding: it adds nothing and costs attention. When the
explanation needs a paragraph, the code needs a better name or a smaller
method first, and the paragraph belongs in ADR.md (8b.3). Evidence: PR #39
went through five comment-trimming rounds; each round's survivors were
paragraphs that explained the ADR, not the line below them.

Evidence: four source files in flight carried between 34 and 67 per cent
comment lines, all of them passing the rule this one replaced.

8b.2 These are findings, every time:

- restating the next line, or the line above;
- narrating a function already named after what it does;
- a docblock on a type that repeats the type's name
  (`/** A row of the pricing_rules table */` above `type PricingRuleRow`);
- documenting a parameter whose type already documents it;
- quoting a REVIEW.md rule number back at the reader;
- a module docblock that retells the design spec. Link the section instead:
  the spec changes and the copy does not.

8b.3 Prose that explains a decision belongs in `ADR.md`, and prose that
explains a mechanism belongs in the design spec. A comment points at them; it
does not reproduce them.

8b.3a **Read your own comments back before you push, against the question "does
a reader with `ADR.md` open learn anything here?"** If the answer is no, the
comment is deleted and a pointer replaces it — the record already has the
reasoning, the file needs only the name of where it lives. This is 8b.3 with a
trigger, because 8b.3 alone did not fire: on one pull request three separate
review rounds removed the same reproduced prose from `docker-compose.yml`,
`migrate.ts` and two test files, each round writing the next copy. The failure
is not ignorance of the rule. It is that the paragraph feels like diligence
while it is being written and only reads as duplication next to the record, so
the check has to happen after writing and before pushing, on the diff, not
while composing. Two shapes are exempt because they are not explanation: a line
that records a measurement (`9.4 s`, `exit 3`) and a line that names the trap a
reader would otherwise fall into.

8b.4 A trimming pass is reviewed by reading what was cut. A deleted comment
leaves nothing behind to notice it went: one trim removed two contracts while
every file looked better afterwards. A contract that only a comment was holding
gets a test in the same pull request, so the next deletion fails something
instead of passing quietly.

8b.5 A comment that states a claim about the code must not outlive it. When a
fix changes behaviour, the `ADR.md` sentence and the design-spec paragraph that
described the old behaviour change in the same commit; leaving the code right
and the prose wrong is the same defect one indirection further away. A comment
or an ADR may cite only what its own branch carries: a forward reference to a
rule or a section that lands in another pull request reads as fact and is not. An ADR states the decision and the current state; it carries no pull
request, commit or issue number — that history is git's. The check for that is
a reader, not a pattern: a quoted error message or a sample value carries
digits and a hexadecimal-looking string without citing anything, and no
tightening tells the two apart, because the difference is what the number
refers to. Grep to find candidates, then read them.

Some references are checkable and some are not. `tests/unit/docs/documented-names.test.ts` reads every backticked repository path, every `Foo.bar` whose `Foo` the tree exports, and every `ADR-00NN` citation out of the deliverable documents and the agent definitions, and fails on one the tree does not hold, with a named exemption for each path a document mentions without claiming it exists; prose claims stay a reader’s, because `value "99999999999" is out of range for type integer` is a quoted error rather than a citation and no pattern tells those apart. Evidence: a day of renames left four documents naming a logger file, a schema directory and a calculator that no longer existed, and two careful readings passed over the same four. Evidence for the member half: a class extraction renamed a method, the code was right everywhere and two ADR bullets still called it by the old name, because an IDE renames the code and never the prose. Evidence for the citation half: a renumber left five citations pointing one record off, and each still read like a valid reference.

8b.6 Configuration files (`docker-compose.yml`, workflows, `.env.example`,
properties) carry no explanatory comments; the entry says what it does. At most
one short line per variable in `.env.example`.

Evidence: a 121-line compose file with 45 comment lines (PR #34).

8b.7 A sentence found stale in review is deleted unless the code cannot be read
without it; correcting it keeps the maintenance that produced the finding.

Evidence: seventeen open review threads on one pull request were all prose that
had drifted from the code, and each earlier round had answered them with more
prose.

---

## 8c. Names match

**Severity: critical. Blocking.**

Raised from warning on 2026-09-13: one declaration per file is the owner's
explicit rule, and as a warning it was passed on a module holding five types,
two schemas and three functions the day after the rule was written.

8c.1 A name says what the thing is. A file and its main export carry the same
word, and when the two disagree, fix whichever is wrong rather than whichever is
easier: usually the wrong one describes how the thing was built instead of what
it is.

Evidence: `http-error.ts` exported a class called `AppError`. The fields were
`status`, `code` and `details`, so the file was right and the class was renamed.

8c.2 One exported declaration per file — `class`, `interface`, `abstract class`,
`enum`, `type` alias or function — in a file named after it, together with the
private helpers only it uses. A second exported declaration in the same file is
a finding, and "they are all about one concept" is not a defence: a concept is
what a directory is for. A type alias counts: a union of string literals is a
declaration a caller imports by name, not punctuation on the interface beside
it.

Evidence: a 199-line module held two interfaces, an abstract base, two classes,
a registry and a factory, all of them sharing the concept "discount
calculation". The alias clause is the owner's reading of 2026-09-13 on PR #29,
written down here so #30, #37 and #39 are judged against the rulebook rather
than against a comment thread (13b.1).

8c.2a One export per file is not one declaration per file. A type read at one
site is written in that signature, and a constant with one reader is a
non-exported constant in the file that reads it; a file that exists only to
satisfy 8c.2 is a finding.

Evidence: an HTTP boundary held seven one-line files — three shared constants,
two interfaces, two lookup tables — every one of them with a single reader.

8c.3 A file is named for the one thing it exports, in kebab-case, the whole
name: the class, interface or type name, or the verb phrase of a free function. A bare
verb with no subject (`validate.ts`) is a finding. ADR-0008. Evidence:
`src/middleware/validate.ts` read as an instruction rather than a thing.

8c.4 Names say what a thing is, not how it was built or when it arrived. No
`utils`, `helpers`, `common`, `misc`, `manager`, `base` or `new` in a file or
directory name: a bucket named after nothing collects everything.

8c.5 Prefer a type that cannot say the wrong thing over a rule asking nobody to
say it. When a rule exists because an expression is legal but always wrong,
look for the deletion that makes the expression unstateable: an argument that
can disagree with another argument, a pair of fields only one combination of
which is valid, a string where a closed set would do. A constructor that cannot
be called incorrectly needs no reviewer to notice, and the rulebook gets shorter
rather than longer.

Evidence: a status argument sat beside an error code, and the pairing between
them was wrong in three different directions across three commits before the
argument itself was deleted and the status derived from the code.

8c.6 The same thing is called the same thing everywhere: the class, the file,
the test file, the directory, the error code, the ADR and the design spec. A
rename that stops at the code and leaves the prose behind is 8b.5 again, one
indirection further away.

Evidence: ADR-0004 on #35 stated the promotion precedence rule three different
ways in one section: "at most one active promotion per product", "at most one
applied promotion", and "product level wins". No single name ran through the
prose, so a rename had nothing to follow.

8c.7 Directories are named for a role (`domain/`, `db/`, `http/`, `events/`),
never for a kind of syntax: `models/`, `types/`, `interfaces/`, `classes/`,
`utils/`, `helpers/` are findings. The tree is in ADR-0008.

8c.8 The one exception to 8c.7: `domain/dto/` holds every shape — type
aliases, interfaces, zod schemas — and `domain/` holds only behaviour, the
classes of 8c.9. An event payload is the exception to the exception: it lives
in `events/` beside the handlers, not in `dto/`. No other directory is split by
syntax. ADR-0008.

8c.9 Behaviour is a class named for its role (`EffectivePriceCalculator`),
its methods start with a verb (`calculate`), its collaborators arrive through
the constructor. A class with no state, no collaborator and no interface is a
finding: it is a function. An interface is the noun of its role (`Discount`),
an implementation the variant plus that noun (`PercentageDiscount`). An
abstract base with fewer than two subclasses, a static-only class, or a helper
with one user in its own file instead of a private method, is a finding.
ADR-0008.

8c.10 `src/shared/` is infrastructure: a file there whose name carries a
business noun (`promotions.ts`, `pricing-rules.ts`) is a finding; it belongs to
the module that owns it, under `db/schema/`. Migrations are the exception and
stay in `shared/db/`. ADR-0008.

8c.11 A class reads top-down: fields, constructor, public methods, then private
methods. What a caller can use is at the top; how it is done is below. ESLint
`@typescript-eslint/member-ordering` holds it from the pull request that lands
the first classes (#39). ADR-0008.

---

## 9. Failure handling and operations

**Severity: warning. Blocking when a failure path has no recovery.**

9.1 Every automated recovery has a manual counterpart and vice versa: retry and
dead-letter, reconciler and rebuild, backpressure and drain. A failure mode with
neither is a finding.

9.2 Retries have exponential backoff and a ceiling. A retry loop without backoff
is an outage amplifier.

9.3 Nothing that can fail loops forever: chunks have a failure limit, jobs reach
the dead-letter set, a stuck lease expires and is visible in the job status.

9.4 Maintenance endpoints that destroy work (`drain`, `rebuild`) require an
explicit confirmation parameter and say in their response what they removed.

9.5 A new failure mode arrives with its metric, so the Grafana rules can see it.

---

## 10. Observability

**Severity: suggestion, except 10.3.**

10.1 Structured JSON logs with a correlation id that survives the queue
boundary: the id travels in the job payload so one ingestion file can be traced
end to end.

10.2 Every price written to the read model can be explained: which promotion,
which pricing-rules version, which event.

10.3 **Blocking:** no secret, token, password or full request body with personal
data reaches a log.

---

## 11. Schema and migrations

**Severity: warning.**

11.1 Migrations are forward-only, reviewed as the DDL deliverable, and each is
idempotent enough to re-run in a fresh database.

11.2 A new column on a large table is nullable or has a non-volatile default; a
new index on a hot table is created concurrently in any environment that matters.

11.3 Every enum change is additive. Index rules are 6.12 to 6.15; a migration
that adds a query-serving index names the query in its comment.

11.4 The migration and the ORM schema describe the same thing; drift is a
finding.

11.5 **A conflict in `meta/_journal.json` is resolved by regenerating the newer
migration, never by reordering the entries.** Drizzle's migrator applies every
entry whose `when` is greater than the single most recently applied row and
never compares the hash it stores, so an entry sorted into the middle of the
journal is skipped for ever on every database that has already passed that
timestamp, while the boot reports success. Sorting is the tidy-looking
resolution and the wrong one: it leaves the file internally ordered, so any
check that only reads the file passes. The comparison that catches it is against
the pull request's base — the entries the base carries are unchanged, and every
new one is newer than all of them — and it lives in the `ci` workflow, because
that is where the refs are; a unit test has no business knowing branch names.
`tests/unit/shared/db/migration-journal.test.ts` keeps only what one file can
answer: increasing, unique timestamps in file order. Evidence: the first version
of the guard asserted the applied row count against a freshly migrated database,
where the timestamps increase by construction, and could not fail; the second
was defeated by sorting the journal, which left both its assertions true.

**Break the thing the test names and watch it fail.** A test and the code it
covers can agree with each other and both be wrong; a mutation is the thing
outside both, because it asks the test a question the code did not supply the
answer to. It is the cheapest check in this file and the one that keeps
catching this family. Evidence, all on pull requests this week: a widened path
scan that was proved load-bearing only by reverting the widening with the
broken paths still in place; a citation regex that matched nothing because an
escape had been eaten; and a coverage threshold that surfaced a fallback
nothing could reach. In each the suite was green and the defect was real.

---

## 12. Keep it small

**Severity: warning.** It was a suggestion, and a suggestion is adopted only
when cheaper than deferring, so no review ever raised it; the rules below were
true of a branch that grew the way they forbid.

12.1 No abstraction with one implementation, no configuration for a value that
never changes, no feature the case does not ask for. Deleting is the preferred
change.

12.2 A deliberate shortcut carries a comment naming its ceiling and the upgrade
path, so the reviewer can tell a decision from an oversight.

12.3 A PR delivers one story. Scope creep is a finding; the extra work goes in
its own pull request, not in an issue to be dealt with later.

12.4 Dependencies: prefer the standard library, then a package already
installed, then a widely used package, and only then code of our own. A
hand-written solution to a problem a widely used package already solves is a
finding, and so is a package that a few lines would express more readably.

Evidence: an HTTP boundary re-implemented status, expose and headers from the
error package its framework installs, and the error serialiser its logger
ships.

12.5 Startup validation checks only what would otherwise fail late and
quietly (a URL that connects to the wrong database, two components sharing one
Redis database, a lease shorter than its budget). One zod `parse` with a refine
per such invariant; everything else fails on first use by itself.

Evidence: a 149-line validator plus 296 test lines replaced by 37 lines (PR #34).

12.6 Complexity per function stays at 10 or below: ESLint `complexity`
(cyclomatic, gates `npm run lint`) and Sonar S3776 (cognitive, on the PR). Above
it, Extract Function or Replace Nested Conditional with Guard Clauses — never a
disable comment.

12.7 A guard against a failure nothing in this repository can produce today is
a finding, however careful it is: the branch that adds the producer adds the
guard, against the real failure. Prose has the same rule — a comment, an ADR
bullet or a test that defends the code against a reader who has not arrived
is deleted, not improved.

Evidence: an HTTP skeleton scrubbed SQL from driver errors, froze tables
nothing assigns to and logged a misconfigured client fleet before any route
queried a database; every open review thread on it was that prose going stale.

12.8 A value is bounded once, where it is produced. A second bound on the same
value downstream, or a bound on a value already bounded upstream, guards
nothing and is a finding.

Evidence: validation details were capped in count and length by the validator,
capped again by the error envelope, and both sat under a body limit that
already bounded them.

12.9 A well-known package is used the way its own documentation shows before
anything of ours wraps it, and a class of ours exists only for a raise, a call
or a shape that recurs at several sites.

Evidence: three files and two tables re-implemented the status, expose and
headers properties that the error package already installed with the framework
documents.

---

## 13. Repository hygiene

**Severity: critical for secrets and identities. Blocking.**

13.1 No credentials in tracked files; `.env.example` holds placeholders only. A
committed secret is flagged and rotated, not merely deleted, because history
keeps it.

13.2 This repository is public: no real customer or personal data in fixtures,
seeds or tests; no internal hostnames, dashboards or ticket references from any
employer. Synthesize everything.

13.3 English only in code, comments, documentation, commit messages and PR text.

13.4 Conventional Commit PR titles. The PR body carries the Case coverage table,
and names the `.claude/agents/*.md` definitions updated when the change adds an
endpoint, job, cache or store.

13.5 An architectural change without a matching `ADR.md` update is a finding.

13.6 A SonarCloud finding is fixed before the pull request goes to the owner.
Read the findings in SonarCloud's own pull request comment; an unreviewed
security hotspot counts as a finding. Silencing one instead needs the
repository owner's approval and an entry in `sonar.issue.ignore.multicriteria`
in `sonar-project.properties` whose comment names the rule, the scope and why
the rule cannot apply there. Widening an existing scope so that a new finding
falls inside it is a finding. Accepting a finding, or marking it won't-fix or
false-positive, in the SonarCloud web interface is the same bypass by another
route, and is a finding for the same reason.

This rule is carried by review, not enforced by a check, and that is a
deliberate stopping point rather than an oversight: the free plan's quality
gate judges ratings, coverage, duplication and hotspot review, so a CRITICAL
code smell passes it, and a gate condition on issue count needs a
custom gate, which SonarCloud asks to be paid for on this project's plan. The
owner reported that from the SonarCloud interface on PR #56; no API answers it.
The alternative — a CI step querying SonarCloud's issue API — was built,
reviewed twice and deleted in PR #56 as machinery that restated what
SonarCloud's pull request comment already says. Before rebuilding it, read that
entry in `docs/ai-appendix-notes.md`. What follows from the rule being a rule:
a finding that disappears between two analyses without a matching change in
this repository is asked about, and `impact-analyzer` checks the comment on
every pre-push round.

Evidence: the one approved ignore is `plsql:S1192` on
`src/shared/db/migrations/*.sql`. The repeated literals there are a schema
qualifier and an enum value in DDL: SQL has no constant to declare for either
(PR #56, `6a0a9c1`).

---

13.7 A scripted edit asserts its anchor matches exactly once before replacing
it. Presence is not enough: assert the count, not that the text is in the file.
Both failure modes are silent at the moment they happen and only surface when
something downstream reads the document.

Evidence, both from one day on this repository: a slice whose end index came
from a heading that appears in several ADRs matched the wrong one, produced an
empty string, and `str.replace("", new)` inserted the replacement between every
character — all seven ADRs became 249 copies of one bullet, and it was pushed,
because the check afterwards looked for the absence of the old text, which a
file of 249 identical bullets passes. The quiet version of the same bug is a
replace that matches nothing, reports success, and ships a document saying the
opposite of what its commit message claims; that one shipped twice before it
was noticed.

13.8 **A merged configuration file is checked by parsing it, not by reading
it.** A merge can leave two blocks under one key, and git, the parser and a
reader are each content: every line is kept, a duplicate key is legal, and each
block is individually correct.

Evidence: two `services:` blocks in `ci.yml` after a merge, of which YAML kept
the second, so every integration test would have run against no Redis.

13.9 **After a merge, re-read the prose against the merged tree — a conflict
marker is not the list of what the merge broke.** The sentences most likely to
be wrong afterwards are the ones that never conflicted, because one side's code
made the other side's claim false while touching none of its lines.

Evidence: the queue story added a `SIGTERM` handler while this branch's ADR
said, thirty lines from anything either side edited, that the process had none.

13.10 A new top-level TypeScript directory joins `tsconfig.json`'s `include`,
or nothing type-checks it; `eslint .` walks the whole tree and gives the opposite
impression. `tsc --noEmit --listFiles` answers the question.

Evidence: `scripts/` arrived while `include` still read `["src", "tests"]`, so
`--listFiles` counted nothing in it while `eslint .` walked it clean.

13.11 A cleanliness check is evidence about the tree at the moment it ran, so
re-run it on what you are about to commit rather than on what you merged into,
and do not treat a merge's own list of conflicted files as the list to resolve:
`git add -A` turns an unmerged path into a staged one, and the markers stop
showing as unmerged. `git diff --check` and `git diff --cached --check` are
git's own and cover both sides; a script that reimplemented them was written and
then deleted, so look in the tool before writing a check.

Evidence: three conflict markers reached `58c6f87` and the pull request opened
from it, because the grep that would have caught them ran before the merge
rather than after.

13.12 **Two files that have to agree are checked by a test that reads both, not
by a diff.** When a value is written twice — a URL in a compose healthcheck and
the route that serves it, a port in a Dockerfile and in a config, a queue name
in a producer and a consumer — changing one side leaves a diff that is
individually correct and a review that has nothing to compare. The side that
did not change is not in the diff at all, so the branch that broke the pair
looks clean. Land a test that reads the value out of one file and exercises the
other.

Evidence: moving the health probe under `/api` left `docker-compose.yml`
fetching `/health`. Both files were right on their own, this branch never
edited compose so the textual diff against `main` was empty, and the container
would never have reported healthy — `up --wait` hanging rather than failing,
which is the slowest way to learn. `tests/unit/docs/compose-healthcheck.test.ts`
now parses the URL out of compose and calls it, and was verified to fail when
the path is put back.

## 13b. The rulebook learns

**Severity: warning.**

13b.1 A review finding that would recur is a rule, not just a fix. When a
finding names a class of mistake rather than one instance, the pull request
that fixes it also adds or sharpens the rule here, in the same commit. The
test is simple: would the same finding be worth making on someone else's PR
next week? Then it belongs in the rulebook.

Evidence: three rules in this section arrived only because someone happened to
notice the pattern behind a finding, and the fourth was a rule that had sat
unenforceable for a day because nothing measured it.

13b.2 A rule that never fires is a bug in the rule. When a finding gets past
review, ask which rule should have caught it and why it did not: usually the
trigger is unreachable, the severity is too low to act on, or the reviewer was
never told to measure it. Fix the rule the same way you would fix code, and
say in the pull request what evidence made it necessary.

13b.3 Rules carry their evidence. A rule states the failure that produced it,
in one line, so a later reader can judge whether it still applies rather than
obeying it out of habit. A rule nobody can trace to a real failure is a
candidate for deletion.

13b.4 Amending a rule in the pull request that discovered it is in scope and
is not scope creep (12.3): the preamble already says the design wins and the
rule gets fixed in the same PR. Quote the amendment in the PR description so
the change to the shared standard is reviewed, not just the code.

13b.5 **A rule's number is allocated once and never reused, never compacted.**
A branch appending to a section takes the next free number; if two branches take
the same one, the loser becomes `13.10a`, not a renumber of everything after it.
A number that moves is an edit to every file that cites it, in a merge where
those files did not conflict — and a citation that has moved one rule off still
names a rule that exists, so the citation check passes and a reader is sent to
the wrong rule.

Evidence: section 13 was renumbered twice in one afternoon on one branch. Both
times two branches had appended to the same section and both had claimed the
next number; both times citations were repointed by hand. The second time, the
check written that morning to catch exactly this stayed green, because the stale
citation still resolved. The defect is the scheme, not the checker: ids that
never move make the check that exists sufficient.

---

## 14. Reviewer's quick pass

Before reading line by line, answer these six. Each "no" is where the findings
usually are.

1. If two of these requests arrive at the same millisecond, what happens?
2. If this process is killed on the line I am looking at, what is left behind?
3. What does this do when the collection has 0 items, 1 item, or 500 000?
4. How many network round trips does this make per item, and which index
   serves each query?
5. Which test would fail if I inverted this condition?
6. What does the reader of `ADR.md` alone believe, and is it still true?
