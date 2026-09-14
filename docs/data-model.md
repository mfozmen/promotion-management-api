# The data model

## Database schema

[`docs/schema.sql`](../docs/schema.sql) is the schema as a single file, for a reader who wants to
open one rather than read six migrations. It is a copy, not an input: nothing reads it at
runtime, and it is re-taken when a migration lands, from a throwaway
database created empty and migrated forward — never from a store that has been developed
against, where an object a regeneration dropped from the migrations can still be present:

```bash
docker compose --profile test exec -T postgres-test createdb -U postgres ddl_export
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/ddl_export npm run db:migrate
docker compose --profile test exec -T postgres-test pg_dump --schema-only --no-owner --no-privileges --exclude-schema=drizzle -U postgres ddl_export > docs/schema.sql
```

against PostgreSQL 16.14 with `pg_dump` 16.14 — a dump from another major is a different file
for reasons that have nothing to do with this schema, so the versions are part of the command.
`--exclude-schema=drizzle` drops the `__drizzle_migrations` ledger, which is the ORM's
bookkeeping rather than part of the design. `--schema=public` looks like the same thing and is
not: it omits `CREATE EXTENSION btree_gist` while keeping both `EXCLUDE USING gist` constraints
that need it, and it adds a `CREATE SCHEMA public` that fails on any database that already has
one — so the file stops replaying, in two ways at once.

Two things the file does not carry, neither accidental. `--schema-only` means the `ingestion`
pricing rules migration `0001` seeds and the single `reconciler_state` row are absent: this is
the schema, and that state lives in the migration where a reader can find it. And `pg_dump`
16.14 writes `\restrict` and `\unrestrict` with a fresh random token on every run, so two dumps
of an unchanged schema differ on exactly two lines, the file's first and last statements — a diff
of that size and shape is the token, not the schema, and it is left alone so that regenerating the
file reproduces what the command emits.

`tests/integration/docs/schema-dump.test.ts` is what notices a migration that landed without
the file being re-taken. It does not diff the two files: it builds one database from the
migrations and one by executing this file, then compares what PostgreSQL's own catalog reports
for each — every column with its type, nullability and default, every enum label in order, every
index, constraint, trigger, function, view, sequence and extension, and whether a column is an identity and of which kind. A text diff would fail on every
unchanged run because of the token above, and a check that fails when nothing is wrong is
switched off within a week. The only thing the test drops from the file is the `\restrict` and `\unrestrict` lines, which are psql meta-commands a server cannot execute; anything else dropped there would
be a difference it stops seeing. It was proved by adding a column to `0000_write_store.sql` and
watching it name that column, not by arguing that it would.

The DDL is the migration set in [`src/shared/db/migrations/`](../src/shared/db/migrations): `0000_write_store.sql` creates the `btree_gist` extension, the five enums, the six tables with their own three indexes (`products_category_id_idx`, `pricing_rules_active_idx`, and the partial unique `ingestion_jobs_one_running_per_vendor`), the two GiST exclusion constraints that enforce one active promotion per product and per category, the `pricing_rules_set_updated_at` trigger with its function, and the single `reconciler_state` row; `0001_seed_pricing_rules.sql` seeds the three `type = 'ingestion'` pricing rules (the promotion-precedence rules are a separate set and arrive with the resolver, ADR-0004), `0002_active_promotions.sql` creates the `active_promotions` view, `0003_promotion_list_indexes.sql` adds the two `(product_id, id)` and `(category, id)` btree indexes the admin promotion list filters and orders on — the GiST exclusion indexes cannot serve it, being partial on `status = 'active'` — and `0004_promotion_boundary_indexes.sql` adds four partial btree indexes on `starts_at`, `ends_at`, `cancelled_at` and `created_at` for the reconciler's boundary sweep, each skipping the rows that sweep never reads (`status <> 'draft'`, and `cancelled_at is not null` for its own), and `0005_reconciler_watermark_milliseconds.sql` narrows `reconciler_state.last_boundary_sweep_at` to `timestamp (3) with time zone`, so the watermark holds only the milliseconds the sweep's compare-and-set can send back (ADR-0007). Each table's Drizzle mirror lives in the module that owns it, under `db/schema/`, one file per table and per enum; `reconciler_state` sits under `src/modules/reconciler/db/schema/`. There is no barrel re-exporting them. Four of the objects above have no expression in it — the extension, the two exclusion constraints, the trigger with its function, and the seed row — so `npm run db:generate` would drop them; CI's "No schema drift" step does not catch that direction — a committed regeneration leaves a clean tree — so the integration tests, which assert each of the four directly, are what notices (ADR-0003). The view is not a fifth: drizzle-kit generated `0002` and its snapshot from `promotion/db/schema/active-promotions.ts`, and `npm run db:generate` reports no changes on a clean tree.

`active_promotions` is the one answer to which clock decides whether a promotion is running: `status = 'active' and tstzrange(starts_at, ends_at) @> now()`, evaluated by PostgreSQL, never re-derived in application code. The resolver selects from it instead of restating the predicate (ADR-0004). The admin reads do not: `GET /api/promotions` and `GET /api/promotions/:id` have to show drafts, scheduled and expired promotions too, which the view by definition does not hold, so they project a five-valued `state` from the same half-open window in SQL (one `sql` fragment in `src/modules/promotion/db/promotion-repository.ts`). The range is half-open: a promotion is live the instant `starts_at` arrives and stops the instant `ends_at` does. `tests/integration/shared/db/active-promotions.test.ts` pins that boundary — it inserts and reads inside one transaction, where `now()` is `transaction_timestamp()` and therefore constant, so an inclusive upper bound fails the test instead of passing it unnoticed. It is not an endpoint; no route exposes it.

`tests/integration/` and the module folders under `src/modules/` are named in the design spec and land with the endpoints that need them. The Redis read model has no DDL of its own, so nothing under `migrations/` describes it. Its keys are the product hash, the two sorted sets, and the `readmodel:source-read-at` token hash that orders every write and outlives a delete (ADR-0003, ADR-0006). The code that writes them is `ProductWriteRepository`, `ProductUpsertedHandler` and `PromotionChangedHandler`, pricing each product through the seeded promotion policy, and the `event-handler` worker consumes both the `products` and `promotions` queues. It rebuilds the read model on boot before it consumes anything, because an empty read model answers `503` to every shopper and no job arrives to fix that; the rebuild is what publishes `readmodel:ready`, and the product routes answer `503` until it does.

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
