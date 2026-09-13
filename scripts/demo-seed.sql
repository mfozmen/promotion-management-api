-- Demo catalogue and one flash sale, so `docker compose up` plus `npm run seed` is a system a
-- reviewer can look at. Not a migration: this data is a demonstration, not the schema, and a
-- production database must be able to skip it. The `ingestion` pricing rules a vendor import
-- applies are the other kind and are seeded by `0001_seed_pricing_rules.sql`.
--
-- Every statement converges rather than appends, so running the seed twice leaves what running
-- it once left: the whole file is one implicit transaction under the simple query protocol.

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
  "updated_at" = now()
WHERE
  ("products"."name", "products"."category", "products"."base_price_cents", "products"."stock_quantity")
  IS DISTINCT FROM
  (excluded."name", excluded."category", excluded."base_price_cents", excluded."stock_quantity");

-- Deleted and re-inserted rather than upserted: `promotions_no_overlapping_active_category`
-- excludes a second active row over the same category and overlapping window, so a second run
-- would raise 23P01 against the row the first one wrote. The delete is by name, so an active
-- promotion an operator created is not in scope and the seed fails against it rather than
-- replacing it.
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
