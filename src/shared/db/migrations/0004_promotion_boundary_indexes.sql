-- Four partial indexes for the reconciler boundary sweep; promotions never shrinks.
CREATE INDEX "promotions_starts_at_idx" ON "promotions" USING btree ("starts_at") WHERE "promotions"."status" <> 'draft';--> statement-breakpoint
CREATE INDEX "promotions_ends_at_idx" ON "promotions" USING btree ("ends_at") WHERE "promotions"."status" <> 'draft';--> statement-breakpoint
CREATE INDEX "promotions_cancelled_at_idx" ON "promotions" USING btree ("cancelled_at") WHERE "promotions"."cancelled_at" is not null;--> statement-breakpoint
CREATE INDEX "promotions_created_at_idx" ON "promotions" USING btree ("created_at") WHERE "promotions"."status" <> 'draft';