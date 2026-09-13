-- Demo catalogue and one flash sale, applied by `npm run seed`. README's "Demo data" says what
-- it produces and what running it twice promises.

-- ponytail: 1 000 rows in one statement, under the pool's 10 s statement_timeout. A realistic
-- catalogue arrives through vendor ingestion, not by raising this number.
INSERT INTO "products" ("sku", "name", "category", "base_price_cents", "stock_quantity")
SELECT
  format('DEMO-%s', lpad(i::text, 4, '0')),
  format('Demo product %s', lpad(i::text, 4, '0')),
  (ARRAY['Electronics', 'Apparel', 'Home', 'Sports'])[1 + i % 4],
  1000 + (i % 200) * 50,
  i % 300
FROM generate_series(1, 1000) AS i
ON CONFLICT ("sku") DO UPDATE SET
  "name" = excluded."name",
  "category" = excluded."category",
  "base_price_cents" = excluded."base_price_cents",
  "stock_quantity" = excluded."stock_quantity",
  -- Every column that explains the price is cleared with it: left behind, they would say an
  -- ingestion job and a rule set produced the number this statement just overwrote.
  "ingest_job_id" = NULL,
  "ingest_source_offset" = NULL,
  "pricing_rules_version" = NULL,
  "updated_at" = now()
WHERE
  ("products"."name", "products"."category", "products"."base_price_cents", "products"."stock_quantity")
  IS DISTINCT FROM
  (excluded."name", excluded."category", excluded."base_price_cents", excluded."stock_quantity")
  OR "products"."ingest_job_id" IS NOT NULL
  OR "products"."pricing_rules_version" IS NOT NULL;

-- By name, so an `Electronics` promotion an operator created is not in scope: the insert below
-- then fails against it on 23P01 rather than replacing it.
DELETE FROM "promotions" WHERE "name" = 'Demo electronics flash sale';

INSERT INTO "promotions" ("name", "discount_type", "value", "starts_at", "ends_at", "category", "status")
VALUES (
  'Demo electronics flash sale',
  'percentage',
  2000,
  now(),
  now() + interval '7 days',
  'Electronics',
  'active'
);
