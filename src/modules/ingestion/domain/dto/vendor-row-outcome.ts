import type { VendorRow } from './vendor-row.js';

/**
 * A bad row is a value, never a throw: one malformed line in a 500 000-row file
 * must cost that line and not the batch around it (ADR-0005).
 *
 * `reason` names the field, never the value — a defect log is not the place to
 * reproduce what a vendor sent.
 */
export type VendorRowOutcome = { ok: true; row: VendorRow } | { ok: false; reason: string };
