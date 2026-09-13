-- The admin promotion list filters on product_id, category and status and orders
-- by id. The two GiST exclusion indexes cannot serve it: both are partial on
-- status = 'active', so ?status=draft and ?status=cancelled miss them entirely,
-- and product_id is a foreign key, which PostgreSQL does not index for you.
-- status alone is left unindexed: it has three values over a table that gains a
-- row per campaign, so a scan is the right plan until the table says otherwise.
CREATE INDEX "promotions_product_id_idx" ON "promotions" USING btree ("product_id","id");--> statement-breakpoint
CREATE INDEX "promotions_category_id_idx" ON "promotions" USING btree ("category","id");