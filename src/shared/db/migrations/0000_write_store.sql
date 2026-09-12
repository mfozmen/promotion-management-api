CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TYPE "public"."chunk_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'paused', 'completed', 'failed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_type" AS ENUM('ingestion', 'promotion');--> statement-breakpoint
CREATE TYPE "public"."promotion_status" AS ENUM('draft', 'active', 'cancelled');--> statement-breakpoint
CREATE TABLE "ingestion_chunks" (
	"job_id" bigint NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_offset" bigint NOT NULL,
	"end_offset" bigint NOT NULL,
	"next_offset" bigint NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"rows_processed" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"status" "chunk_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	CONSTRAINT "ingestion_chunks_job_id_chunk_index_pk" PRIMARY KEY("job_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingestion_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vendor" text NOT NULL,
	"file_ref" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"chunks_total" integer NOT NULL,
	"chunks_done" integer DEFAULT 0 NOT NULL,
	"rows_processed" bigint DEFAULT 0 NOT NULL,
	"rows_rejected" bigint DEFAULT 0 NOT NULL,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_jobs_file_sha256_unique" UNIQUE("file_sha256")
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pricing_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "pricing_rule_type" NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"event" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"base_price_cents" bigint NOT NULL,
	"stock_quantity" integer NOT NULL,
	"pricing_rules_version" integer,
	"ingest_job_id" bigint,
	"ingest_source_offset" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_base_price_cents_check" CHECK ("products"."base_price_cents" >= 0),
	CONSTRAINT "products_stock_quantity_check" CHECK ("products"."stock_quantity" >= 0),
	CONSTRAINT "products_ingest_provenance_check" CHECK (("products"."ingest_job_id" is null) = ("products"."ingest_source_offset" is null))
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promotions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"calculator" text NOT NULL,
	"params" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"product_id" bigint,
	"category" text,
	"status" "promotion_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "promotions_window_check" CHECK ("promotions"."ends_at" > "promotions"."starts_at"),
	CONSTRAINT "promotions_active_target_check" CHECK ("promotions"."status" <> 'active' or ("promotions"."product_id" is null) <> ("promotions"."category" is null)),
	CONSTRAINT "promotions_draft_target_check" CHECK ("promotions"."status" <> 'draft' or ("promotions"."product_id" is null and "promotions"."category" is null))
);
--> statement-breakpoint
CREATE TABLE "reconciler_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"last_boundary_sweep_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciler_state_single_row_check" CHECK ("reconciler_state"."id")
);
--> statement-breakpoint
ALTER TABLE "ingestion_chunks" ADD CONSTRAINT "ingestion_chunks_job_id_ingestion_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_jobs_one_running_per_vendor" ON "ingestion_jobs" USING btree ("vendor") WHERE "ingestion_jobs"."status" in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "pricing_rules_active_idx" ON "pricing_rules" USING btree ("type","priority" DESC NULLS LAST) WHERE "pricing_rules"."active";--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category","id");--> statement-breakpoint
-- At most one active product-level promotion per product per instant, and the same per
-- category. Drizzle has no builder for exclusion constraints, so they are written by hand;
-- both GiST indexes also serve the point lookup
-- "target = $1 and tstzrange(starts_at, ends_at) @> now()".
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_no_overlapping_active_product" EXCLUDE USING gist ("product_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'active' AND "product_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_no_overlapping_active_category" EXCLUDE USING gist ("category" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'active' AND "category" IS NOT NULL);--> statement-breakpoint
-- The reconciler sweeps from a watermark, so the single row has to exist before it first runs.
INSERT INTO "reconciler_state" ("id") VALUES (true) ON CONFLICT DO NOTHING;