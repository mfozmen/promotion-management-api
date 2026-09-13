-- The reconciler's boundary sweep filters on four timestamps and `promotions`
-- never shrinks: cancelling is the cure for the all-time exclusion constraints,
-- so the table accumulates and a sequential scan grows with it. Partial on the
-- rows the sweep can name, since a draft has no target to recompute.
CREATE INDEX IF NOT EXISTS promotions_starts_at_idx
  ON promotions (starts_at) WHERE status <> 'draft';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS promotions_ends_at_idx
  ON promotions (ends_at) WHERE status <> 'draft';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS promotions_cancelled_at_idx
  ON promotions (cancelled_at) WHERE cancelled_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS promotions_created_at_idx
  ON promotions (created_at) WHERE status <> 'draft';
