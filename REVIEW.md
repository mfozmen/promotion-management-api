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

1.3 Exactly one implementation of the discount formula exists
(`src/modules/promotion/effective-price.ts`). A second copy inline in a query, a
worker or a test fixture is a finding even when it agrees today.

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
fine" is not a test.

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
unless one of the §3.1 mechanisms serialises the writers; the read-model writer
is safe only because a single event-handler instance runs at concurrency 1,
and a change that adds a second consumer must add a lock or a Lua script in the
same PR. Elsewhere use a single command, a pipeline that does not depend on
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

5.3 No `FLUSHALL`/`FLUSHDB`. Rebuilds use `SCAN` + `UNLINK` by prefix on the
read-model database only. `KEYS` in any code path is a finding.

5.4 The queue database and the read-model database are separate logical
databases; no maintenance operation can reach the queue.

5.5 Pagination is bounded: page size has a hard cap, the cap is enforced server
side, and the sort is total (a tiebreaker column) so pages cannot repeat or skip
rows within one version.

5.6 A cache entry whose freshness depends on another key states how the two are
kept consistent. A key that can be written without its index (`HSET` without the
matching `ZADD`) is a finding.

5.7 The read model has no TTL and no database fallback by design; freshness
comes from events and the reconciler. A PR that introduces a TTL, a lazy
fill-on-miss, or any read-through path reintroduces stampedes and the
cancel-then-read race, and must bring the stampede lock and the ordering
argument with it.

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
that. `ZRANGE` with `LIMIT` is O(log N + M); a `ZRANGE` without `LIMIT`, an
`SMEMBERS` on a large set, or an `HGETALL` on an unbounded hash is a finding.
Big pipelines are chunked (about 1 000 commands) so one reply does not buffer
the whole category.

6.22 **Measure what you claim.** Any change to a storefront route, the event
handler or the chunk processor reports the `e2e-tester` numbers in the PR:
requests per second, p50, p99, peak RSS. "Should be faster" without a number is
a finding.

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
- A product carrying both a product-level and a category-level promotion gets
  whichever of the two prices lower, so a deeper category discount wins over
  the product's own.
- Cancelling the category promotion restores base price for every product
  that had no promotion of its own, and leaves the others untouched.

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
at `trace`.

7.5 **Determinism.** Fixed clocks (injected `now` or fake timers), fixed
fixtures, no random data, no `sleep` to wait for a worker. Poll a condition with
a timeout. A flaky test is a finding, not a retry.

7.6 **Isolation.** Each test file owns its data; tests pass in any order and in
parallel. Shared mutable fixtures across files are a finding.

---

## 8. Boundaries, errors and API shape

**Severity: warning.**

8.1 Every body, query parameter and path parameter is validated with zod at the
boundary; handlers receive parsed, typed values. Unknown fields are rejected
rather than ignored, so a typo in a client is visible.

8.2 Numeric query parameters are validated as integers with bounds. `page=-1`,
`page=1e9`, `pageSize=99999` and `page=abc` each have a defined answer.

8.3 Errors are `{ error: { code, message, details? } }` with the right status:
`400` validation, `404` missing, `409` conflict, `429` backpressure, `503` read
model not ready. The message is for a human; the code is for a client.

8.3b A response may name where a problem is and which of the caller's own
fields or identifiers it concerns. It never reproduces a stored value, and it
never repeats a free-form value the caller sent: a value is not an identifier
and there is nothing to fix by seeing it again, so a 404 does not echo the path
and a parser's message is replaced rather than forwarded.

Evidence: `conflicts with promotion "Summer Sale" (id 7, 50 %)` hands the caller
another row's fields, which they never had. `Unrecognized key: "discountTyp"` is
correct: the client cannot fix the request without knowing which of its own keys
was wrong.

8.3c Cap an echoed field name or identifier at 64 characters and truncate
rather than omit, so a long key cannot turn an error body into a mirror.

Evidence: the first draft of the exception had no bound, so a multi-kilobyte key
would have come straight back in the error body.

8.4 No internal detail escapes: no stack trace, no SQL text, no connection
string, no secret, in a response or a log line.

8.5 Handlers log and rethrow; `catch {}` is a finding. A caught error that is
neither logged nor rethrown is a silent failure.

8.6 Request body size is capped, and the cap is smaller than what would exhaust
memory on the smallest configured container.

---

## 8b. Comments

**Severity: warning.**

8b.1 A comment earns its line by saying something the code cannot: a
non-obvious invariant, a unit that is not in the name, a reason the obvious
approach was rejected, a shortcut's ceiling, a contract a caller must honour.

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
rule or a section that lands in another pull request reads as fact and is not.

---

## 8c. Names match

**Severity: warning.**

8c.1 A name says what the thing is. A file and its main export carry the same
word, and when the two disagree, fix whichever is wrong rather than whichever is
easier: usually the wrong one describes how the thing was built instead of what
it is.

Evidence: `http-error.ts` exported a class called `AppError`. The fields were
`status`, `code` and `details`, so the file was right and the class was renamed.

8c.2 One declaration per file. Every `class`, `interface`, `abstract class` and
`enum` lives in its own file named after it, together with the private helpers
only it uses. A second exported declaration in the same file is a finding, and
"they are all about one concept" is not a defence: a concept is what a directory
is for.

Evidence: a 199-line module held two interfaces, an abstract base, two classes,
a registry and a factory, all of them sharing the concept "discount
calculation".

8c.3 A file is named for its role as a kebab-case noun, `<subject>-<role>.ts`,
never for the verb it exports. `request-validator.ts`, not `validate.ts`, beside
`error-handler.ts`.

Evidence: `src/middleware/validate.ts` exported `validate()` and read as an
instruction rather than a thing.

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

---

## 12. Keep it small

**Severity: suggestion.**

12.1 No abstraction with one implementation, no configuration for a value that
never changes, no feature the case does not ask for. Deleting is the preferred
change.

12.2 A deliberate shortcut carries a comment naming its ceiling and the upgrade
path, so the reviewer can tell a decision from an oversight.

12.3 A PR delivers one story. Scope creep is a finding; the extra work goes in
its own pull request, not in an issue to be dealt with later.

12.4 Dependencies: prefer the standard library, then something already
installed. A new dependency for a few lines of code is a finding.

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
