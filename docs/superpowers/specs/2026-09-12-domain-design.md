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
  ingestion_rules_version  integer,                -- set by ingestion, null for manual creates
  ingest_job_id          bigint,                 -- ingestion job that last wrote this product (identity, monotonic)
  ingest_source_offset   bigint,                 -- byte offset of that row inside its file
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index products_category_id_idx on products (category, id);   -- keyset scans per category

create type discount_type as enum ('percentage', 'fixed');
create type promotion_status as enum ('draft', 'active', 'cancelled');

create table promotions (
  id             bigint generated always as identity primary key,
  name           text not null,
  discount_type  discount_type not null,                        -- 'percentage' | 'fixed'
  value          integer not null check (value > 0),            -- basis points, or minor units
  -- integer, not bigint like products.base_price_cents: a percentage is at
  -- most 10 000 basis points, and a fixed discount is capped at ~21 M minor
  -- units, which is a promotion rather than a price. Matches the migration on
  -- the write-store branch; REVIEW.md 1.1 names bigint for prices, and this
  -- column is a discount.
  check (discount_type <> 'percentage' or value <= 10000),      -- 100 % is the ceiling
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  product_id     bigint references products (id),
  category       text,
  status         promotion_status not null,                    -- 'draft' until assigned, then 'active'
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  check (ends_at > starts_at),
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

create type pricing_rule_type as enum ('ingestion', 'promotion');

create table pricing_rules (                    -- json-rules-engine rules, both layers
  id          bigint generated always as identity primary key,
  type        pricing_rule_type not null,
  name        text not null,
  conditions  jsonb not null,
  event       jsonb not null,
  priority    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pricing_rules_active_idx on pricing_rules (type, priority desc) where active;

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

- **Active** = `status = 'active' and tstzrange(starts_at, ends_at) @> now()`
  — the half-open window `[starts_at, ends_at)`, spelled as the range operator
  rather than as two comparisons so it uses the GiST index (REVIEW.md 6.14) —
  decided by the **database clock** and evaluated only in SQL — the
  `active_promotions` view, or the resolution query's `WHERE` until that view
  lands (REVIEW.md 2.7). The application never forms its own opinion and never
  takes an injected `now`: no TypeScript copy of the predicate exists to
  disagree with SQL, the last one having been deleted with its tests
  (`33422ce`). Two clocks for one predicate is how a read model publishes a
  discount for a promotion SQL considers expired.
- **Applied promotion** for a product is decided by `json-rules-engine`, not by
  hard-coded precedence (owner decision, 2026-09-12). The resolver collects
  every active promotion that could apply to the product (its product-level
  one and its category's), builds a fact object, and runs the promotion rules
  loaded from `pricing_rules` where `type = 'promotion'`. The rule that fires
  with the highest priority names the winning candidate; ties break on the
  `<=` in `lower-price-product`, which is a row like the rest of the policy.
  There is no resolver-side id tiebreak: the exclusion constraints already
  guarantee one candidate per level, so two candidates never share one, and an
  equal price is decided by that `<=` before any id would be consulted. A
  tiebreak in code would be a branch no test could reach. The rules are data,
  so
  the precedence policy changes without a deploy.
- **The rule decides which promotion wins; it does not decide how one is
  computed.** A matching rule's event names the winner and nothing else:
  `{ type: 'selectCandidate', params: { level: 'product' | 'category' } }`.
  The arithmetic is not in the rule, not in a registry the rule can name and
  not in a parameter bag — it is a pure calculator per discount type behind one
  pure entry point.
- **One function, one vocabulary.** `effectivePrice(basePriceCents, promotion)`
  in `src/modules/promotion/domain/` takes
  `Pick<Promotion, 'discountType' | 'value'>` — `discountType` of
  `percentage | fixed`, `value` in basis points or minor units — and returns a
  `PricingOutcome`, a discriminated union of
  `{ ok: true, effectivePriceCents }` or `{ ok: false, reason }`. A failure
  carries no price, so a caller cannot publish one by mistake. The parameter is
  narrowed rather than the whole row because the resolution query stopped
  selecting `starts_at`/`ends_at` once the windows left the fact set: a
  parameter typed `Promotion` demands `status`, `startsAt` and `endsAt`, which
  the resolver has no columns to supply; the function body reads neither the
  window nor the status. Whether a candidate is active was decided by that
  query on the database clock before it reached the function. Percentage is
  `base - floor(base * bps / 10000)` and fixed is `max(base - value, 0)`, each
  in its own `DiscountCalculator` (`percentage-discount.ts`,
  `fixed-discount.ts`) together with its own value check — the 10 000
  basis-point ceiling belongs to percentage, not to the guard.
  `effectivePrice` looks one up instead of branching on the type;
  arithmetic in `bigint`, the result clamped to `[0, base]` by
  `effectivePrice`. A third kind of
  discount is a migration that widens the enum plus a calculator file the
  `Record<DiscountType, DiscountCalculator>` will not typecheck without, and
  that is the right cost:
  the case names two, and a vocabulary the reader can enumerate is worth more
  than one that can hold anything.
- **The union is exhaustive; the database is not.** The enum can widen a deploy
  before the union does, so the map is reached only through
  `discountCalculatorFor(discountType: string)`, which checks own properties —
  a `discountType` of `toString` resolves nothing — and returns
  `DiscountCalculator | undefined`. `effectivePrice` turns `undefined` into
  `{ ok: false, reason: 'unknown discount type' }`, so a row the code does not
  understand yet is a defective row and a log line, not a throwing event
  handler that retries and leaves the product unpriced.
- **Selection compares candidates, so each is priced first.** The resolver
  runs `effectivePrice` for every candidate, then runs the engine once over a
  single fact set — the only one, so a rule author has one list to read, and it
  is the flat shape given below. The candidates' windows are not in it: the
  resolution query already filters to active promotions, so a window fact could
  only ever describe an active one and no rule could learn anything from it. A rule can therefore compare them, which
  `json-rules-engine` supports by giving an operator a `{ fact: ... }` value
  rather than a literal. The resolver applies the outcome it already computed
  for the winning level, so each candidate is priced once.
- **Pricing rules are a separate module with separate semantics.**
  `src/modules/pricing/` holds the `json-rules-engine` rules that Scenario A's
  ingestion uses to adjust a vendor's base price. Neither module imports the
  other: a promotion is a row a human created with a window and a target, an
  ingestion adjustment is a rule applied to a feed. Sharing a cross-module
  registry between
  them is what this design tried and the owner reversed — the two look alike
  only at the level of "something changes a number".

- **The seeded default is the lower effective price, in the customer's favour**
  (owner decision). Whichever candidate prices the product lower is applied, so
  a 50 % category sale also covers an accessory carrying its own 5 % promotion,
  which is what a shopper expects a sale to mean. An equal price is decided by
  the `<=` in `lower-price-product`, not by an id.
  A higher-priority rule overrides the default by naming the
  other candidate — which is how a product whose own price was set deliberately
  keeps it inside a category sale. It cannot select _nothing_: the event
  vocabulary is `product | category`, so a product with no promotion of its own
  cannot be held out of a category sale without a `level: 'none'` the design
  does not have. Say so rather than promise the general case.
- **The promotion rules are cached for 60 seconds and nothing invalidates
  them.** After a policy edit, workers hold two policies for up to a minute,
  and thereafter only products that receive an event are re-resolved directly.
  The reconciler's sampled sweep does heal the rest — it compares a sample per
  category against PostgreSQL and enqueues a rebuild on a mismatch — so the
  exposure is probabilistic over several runs rather than indefinite, which is
  a weaker guarantee than it sounds and is why it is written down. Closing it
  properly needs a version to compare (`pricing_rules.updated_at` is the
  obvious carrier; there is no version column today) and a write path to hang
  the trigger on (there is no `pricing_rules` endpoint in section 10). Neither
  is built here.
- **No test pins the runtime policy, and one test does read the seed.** A test
  asserting the row a running database happens to hold would make the policy
  unchangeable without turning CI red, and a policy that cannot change is not
  data. Reading the _seeded_ rules out of the migrated database is a different
  thing: the seed is a migration row — code, reviewed, changed by commit — so a
  test that it selects the lower price is a test that the seed we ship is the
  seed we meant, and the two change together. Everything else inserts the rule
  row it asserts against and checks the mechanism: given this rule, the engine
  selects this candidate.
- `category` and `stockQuantity` are product facts the seeded rules do not
  read. They stay because they are already selected for the product row and are
  what an operator's first two rules would key on — a margin floor by category,
  a stock-based adjustment. **They are as fresh as the product's last event, and
  no fresher.** A product is re-resolved when it receives one; nothing watches
  stock. There is no stock-update endpoint in section 10, so on this design a
  rule reading `stockQuantity` re-evaluates on the next ingestion run — weekly,
  not when stock crosses the threshold. Such a rule passes its test and lags in
  production, which is the whole of the warning. The candidates' windows were in this list and are
  not any more: the query filters to active promotions, so they carried no
  information a rule could use, and the columns feeding them came back out of
  the query with them.

- Exactly one rule applies per product. Rules are evaluated in priority order
  and the highest-priority match wins, which is what keeps the case's "at most
  one active promotion" true at the applied level. Letting several stack would
  be a change to that one selection step, not to the pricing function.
- **A failed computation is not a silent base price.** `effectivePrice` returns
  `{ ok: false, reason }` for a row the boundary should have rejected — a value
  above 10 000 basis points, a base price outside the safe-integer range. The
  event handler logs it with the `promotionId` and writes the price the
  surviving candidates resolve to — the base price only when no candidate
  priced. An unpriceable candidate is absent to the rules, so a product whose
  own promotion is defective still takes its category's sale price rather than
  standing at full price inside it. The product is priced and the defect is
  visible; ingestion counts it as a
  rejected row rather than aborting the batch. Neither path leaves the previous
  price in Redis with nothing recorded.
- **The fact set always carries both candidate slots, and an absent one is
  `null` rather than missing.** Most products in a category sale have no
  promotion of their own, so arity one is the ordinary case, not the edge: a
  seeded rule that only compares two candidates would match nothing for them,
  no rule would fire, and a 50 % sale would publish base prices for 50 000
  products while a two-candidate test stayed green. The seeded rule set covers
  arity one explicitly — one candidate present means that candidate wins — and
  section 12 runs the seed over a one-candidate product for exactly this
  reason.
- **The fact set is flat, and an absent candidate is JSON `null` in every one
  of its keys.** `basePriceCents`, `category`, `stockQuantity`, then
  `productDiscountType`, `productValue`, `productEffectivePriceCents` and the
  same three under `category…`. Flat rather than nested because a rule tests an
  absent candidate with `equal: null`, and `path: '$.id'` into a `null` object
  yields `undefined`, which is not `null` under `json-rules-engine`'s `equal` —
  a nested shape would make every arity-one rule silently never fire.
- **The slot is the effective price.** "Slot non-null" in the table below means
  `productEffectivePriceCents` / `categoryEffectivePriceCents`, never the
  discount type or the value. A candidate that exists but cannot be priced —
  `effectivePrice` returned `{ ok: false }` — is `null` in **all three** of its
  keys plus a defect log carrying the `promotionId`, so it is absent to the
  rules rather than half-present. Without this the two readings diverge on a
  real customer: null the keys and the category discount applies with the
  product promotion silently gone; write the base price into the price key and
  `lower-price-category` fires instead. Both are defensible, so the spec picks
  one.
- **The seeded rule set is four rules, not three**, because a rule carries one
  event and "the lower price wins" is two outcomes. One rule comparing the
  candidates could only ever name one level; the other comparison would match
  nothing, no event would fire, and the product would publish its base price in
  the middle of the sale.

  | priority | rule                   | condition                                              | event                   |
  | -------- | ---------------------- | ------------------------------------------------------ | ----------------------- |
  | 30       | `product-only`         | product slot non-null **and** category slot `null`     | `{ level: 'product' }`  |
  | 20       | `category-only`        | category slot non-null **and** product slot `null`     | `{ level: 'category' }` |
  | 12       | `lower-price-product`  | both non-null, `productEffective <= categoryEffective` | `{ level: 'product' }`  |
  | 11       | `lower-price-category` | both non-null, `categoryEffective < productEffective`  | `{ level: 'category' }` |

  Each condition names **both** slots. A single-sided condition — "category
  slot is null" alone — matches a product carrying no promotion at all, which
  is most of the catalogue, and would emit an event naming a candidate that is
  not there: one defect log per product, half a million of them per ingestion
  recompute. With both slots named, arity zero matches nothing and the base
  price stands, which is the intended path rather than a defect path.

- **Priorities 10–30 are reserved for the seed; an operator override sits above 30.** The four seeded rules are mutually exclusive, so their order decides
  nothing between themselves — the band matters against rules added later. An
  override written at 25 to protect a deliberately set product price beats
  `lower-price-*` but is shadowed by `product-only` at 30, so the same intent
  would behave differently depending on whether a category sale happened to be
  running. Distinct priorities are a contract rather than a convention:
  `json-rules-engine` evaluates equal priorities concurrently and the order of
  `results` is not guaranteed. The resolver **selects the event whose rule
  carries the highest `priority` in `results`** — not `results[0]`, and not the
  first event emitted. `json-rules-engine` evaluates every rule and returns
  every match; it does not stop at the first success. Reading positionally is
  correct only by accident of buckets running in descending priority while
  rules inside a bucket run concurrently, which the library does not promise
  across versions. The first operator override above 30 makes two events fire
  on the same product, and that is the ordinary case, not a defect. A priority
  collision is still logged at load, which is a seed defect.
- If no rule fires, no promotion is applied and the base price stands. A rule
  that names a candidate which is not in the fact set is a defect, logged and
  ignored rather than thrown, so a bad rule cannot take the storefront down.
- **Silence with a candidate present is counted.** "No rule fired" and "no
  candidate existed" are the same outcome — the base price — and only one of
  them is intended. A counter increments when the fact set holds at least one
  non-null candidate and no event fired. For the seeded four that condition is
  unreachable, so it reads zero until the policy breaks; the alternative is
  that an operator's mistyped condition drops a sale across 500 000 products
  with nothing in the logs, and the reconciler cannot catch it because it
  resolves through the same rules.
- The rule the case calls "at most one active promotion per product" is
  implemented as **at most one applied promotion**. A product-level and a
  category-level promotion may both exist; the seeded rule applies whichever
  prices the product lower, so a 50 % category sale also covers an accessory
  carrying its own 5 % promotion, and nothing stacks. The storefront response
  names the promotion that was
  applied, so an admin can always tell which of the two won and why.
- Same-level overlap (two active product promotions on one product, or two on
  one category, overlapping in time) is still rejected with `409` by the
  exclusion constraints (SQLSTATE 23P01), and the handler selects the
  overlapping promotion to report `{ conflictingPromotionId }`. The engine
  would pick a winner either way, so this is no longer about correctness: it
  keeps an admin from quietly shadowing a colleague's campaign, and it keeps
  the candidate set small enough that resolution stays a two-row decision.
  Relaxing it later is a constraint drop plus a priority rule, with no change
  to the resolver.
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
select p.*, pp.id as pp_id, pp.name as pp_name, pp.discount_type as pp_discount_type, pp.value as pp_value,
             cp.id as cp_id, cp.name as cp_name, cp.discount_type as cp_discount_type, cp.value as cp_value
from products p
left join promotions pp on pp.product_id = p.id and pp.status = 'active'
                       and tstzrange(pp.starts_at, pp.ends_at) @> now()
left join promotions cp on cp.category = p.category and cp.status = 'active'
                       and tstzrange(cp.starts_at, cp.ends_at) @> now()
where p.id = any($1);
```

## 5. Read model (Redis DB 0)

| Key                   | Type | Content                                                                                                                                     |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `product:{id}`        | HASH | `id, sku, name, category, basePriceCents, effectivePriceCents, stockQuantity, promotionId, promotionName, ingestionRulesVersion, updatedAt` |
| `category:{category}` | ZSET | score = `effectivePriceCents`, member = product id                                                                                          |
| `products:all`        | ZSET | same, across all categories (listing without a category filter)                                                                             |
| `readmodel:ready`     | STR  | present once a full rebuild has completed; storefront routes answer `503` until then                                                        |

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
the reconciler's boundary sweep (section 9) covers a lost one.

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
   (`json-rules-engine`, rules loaded from `pricing_rules` where
   `type = 'ingestion'` and cached for 60 s), producing `base_price_cents` and `ingestion_rules_version`. Invalid
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
commit order**: `products.ingest_job_id` and `products.ingest_source_offset`
record which job and which byte offset last wrote the product, and the upsert
carries
`where products.ingest_job_id is null or (excluded.ingest_job_id, excluded.ingest_source_offset) > (products.ingest_job_id, products.ingest_source_offset)`
(row-value comparison with the null case stated first: both columns are null
on manually created products, and a row comparison against null yields null,
not true, so without the explicit `is null` branch the first ingested row for
such a product would be silently dropped). Job ids come from the
identity column and only one job per vendor runs at a time, so a newer file
always carries a higher job id: within a file the later row wins no matter
which worker commits first, and across files the newer file wins even when its
row sits at a smaller offset. `--scale ingestion-worker=N` is safe.

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
5. Cancel: `status = 'cancelled'` → delayed jobs removed → immediate `promotion.changed` → category rescanned → base price restored for products with no promotion of their own, and their own effective price for the rest.
6. Scheduled start/end: the delayed `activate`/`expire` jobs fire at the boundary; the read model changes within the handler's scan time, not on a cache TTL.

Base-price changes during a sale (vendor ingestion, the only update channel) go through
`product.upserted` and pick up the active promotion in the recompute.

## 9. Safety net

Automatic:

- **Retry + backoff + DLQ**: 3 attempts, exponential backoff, failed set kept as the dead-letter queue.
- **Stalled recovery**: BullMQ stalled detection with `lockDuration` sized to the time budget; a crashed worker's job is re-run and the lease lets the next worker claim it.
- **Checkpoint resume**: the compare-and-set `next_offset` means a retry continues, never restarts, and two workers cannot both advance one chunk.
- **Backpressure**: `429` on new imports above `INGESTION_MAX_WAITING`.
- **Category-scoped reconciler** (`reconcile.run`, every 5 min): per category compare `ZCARD` with `count(*)`, recompute a random sample of `max(50, ceil(count / 100))` products (capped at 500) and compare with the hashes (the count comparison catches missing or extra entries exactly; the sample means a wrong price can survive one run, and every run resamples, so the exposure is bounded in minutes rather than guaranteed zero), and sweep promotions whose `starts_at`, `ends_at` or `cancelled_at` fell between the previous successful sweep and now (`cancelled_at` because a cancel whose `promotion.changed` was lost need have no boundary of its own in the window, ADR-0003; the watermark lives in `reconciler_state.last_boundary_sweep_at`, a one-row table, written only after the sweep succeeds, so a long outage is caught up on the first run back; re-emitting `promotion.changed` is idempotent). A mismatch enqueues `readmodel.rebuild { category }`, never a full rebuild. The same run performs the **ingestion orphan sweep**: for every job in `running`, chunks that are `pending`, or `running` with an expired lease, get a fresh `ingestion.chunk` job (idempotent thanks to the claim).
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
`ingestion_rows_processed_total`, `ingestion_chunks_stuck`,
`promotion_rules_no_event_total` — the silence counter of section 4, which the
seeded rules cannot increment). Prometheus
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

`GET /api/products` pages by offset over ZSET scores that a category rescan rewrites progressively, so a page taken while a sale is being applied can repeat a row or miss one until the scan finishes. Stated rather than claimed away (REVIEW.md 5.5); an exclusive `(score, id)` cursor is the upgrade.

## 11. Layout

Target layout: a file appears here before it exists on disk, and lands with the PR that needs it.

```
src/
  app.ts, server.ts                      Express wiring / API entry point
  modules/
    product/     product.routes.ts, product.service.ts, product.repository.ts, product.schemas.ts, read-model.ts
    promotion/
      domain/    promotion.ts (the Promotion row as a type), discount-type.ts, promotion-status.ts (its two closed sets), pricing-outcome.ts (PricingOutcome), effective-price.ts (effectivePrice, pure), pricing-input-error.ts (pricingInputError, the guards), discount-calculator.ts (the DiscountCalculator interface: valueError + discountCents), percentage-discount.ts and fixed-discount.ts (one calculator each, formula and value check together), discount-calculators.ts (Record<DiscountType, DiscountCalculator>), discount-calculator-for.ts (the only lookup; undefined for a type the union does not have), candidate-selection.ts (runs the engine over already-loaded rules, pure)
      db/        promotion.repository.ts, selection-rules.repository.ts (loads the type='promotion' rules, holds their cache)
      http/      promotion.routes.ts, promotion.service.ts, promotion.schemas.ts
      jobs/      scheduling.ts
    pricing/     ingestion-rules.ts (json-rules-engine wrapper), resolve-products.ts (section 4 query)
    vendor/      vendor.routes.ts, import.service.ts (register/chunk), chunk-processor.ts (processChunk), csv-lines.ts (byte splitter), schemas
    admin/       admin.routes.ts, queues.service.ts, read-model-rebuild.ts, health.ts
  workers/       events.ts, ingest.ts, reconcile.ts   (thin entry points: create worker, register handler, start)
  shared/        config.ts, db.ts (Drizzle + migrations), redis.ts, events.ts (event schemas, queue routing), queue.ts (BullMQ queues), shutdown.ts, logger.ts (pino, request ids)
tests/                 three layers, each mirroring src/, one test file per source file (REVIEW.md 7.7)
  unit/          effective-price, csv-lines, ingestion-rules, schemas
  integration/   routes + handlers against real PostgreSQL and Redis (docker compose), concurrency, ingestion kill/resume
  e2e/           the docs/e2e-cases scenarios against the running compose stack
docker-compose.yml   postgres, redis, api, event-handler, ingestion-worker (256M / 0.5 CPU), reconciler; profile "monitoring": prometheus, grafana (provisioned dashboard + alert rules); profile "tools": pgadmin, redis-commander
Dockerfile           one image, command per service
```

## 12. Testing

- Edge cases that must have a named test: cancel an unassigned draft (no
  target, allowed by the CHECKs), assign a non-draft (`409`), assign with
  both or neither target (`400`), a vendor row with a negative price or stock
  rejected without aborting its batch, an ingested row updating a manually
  created product (null ingest columns), a category promotion whose category matches
  no product (`201` with `productCount: 0` and a warning log), assigning a draft whose `endsAt` has passed
  (`409`), two concurrent assigns of one draft (one `200`, one `409`), a
  product created in a category with an active promotion is discounted on its
  first read, a budget release leaving `failures` untouched while an
  error increments it, and a reconciler catch-up after an outage longer than
  its period (watermark sweep re-emits the missed boundary).
- Named case: the **seeded** rule set, read from the migrated database, applies
  `min(candidates)` for a two-candidate product and the only candidate for a
  one-candidate one. It asserts the seed's policy, not merely that a winner
  exists — a seed whose comparison is inverted would still name _a_ winner and
  would charge the higher of the two discounted prices through every flash
  sale. The one-candidate case is there because a category sale over products
  with no promotion of their own is the ordinary case, and a rule that only
  compares pairs matches nothing for it: without that assertion, 50 000
  products publish base prices with the suite green.
- Named case, required by REVIEW.md 7.4: two candidates active on one product,
  the lower effective price is applied, and a higher-priority rule overrides
  it. That test inserts the rule rows it asserts against. No test reads the row
  a **running** database holds — the seed is code and is tested as code; the
  runtime row is data and an operator editing it must not turn CI red.
- Test files import their subject through the `@src/*` alias (`tsconfig.json`
  `paths` plus a matching `vitest` `resolve.alias`, `ee6aa9e`), so a test five
  directories deep does not carry a relative path that breaks silently when a
  file moves. Production code under `src/` keeps relative specifiers: `tsc`
  does not rewrite path aliases on emit, so an alias in `src/` would compile to
  an import Node cannot resolve — and it fails at container start, not at
  build. An ESLint `no-restricted-imports` rule scoped to `src/**/*.ts`
  enforces that (`40cf7ba`). Tests are never emitted, so nothing reaches the
  runtime through the alias.
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
