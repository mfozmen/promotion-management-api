/** How deep a shopper may page. `ZRANGE ... LIMIT offset` skips `offset`
 *  members before it returns anything, so a large page number walks the whole
 *  sorted set on a single-threaded server: the page size caps the fan-out, not
 *  the scan. A keyset cursor on `(score, id)` is the upgrade when a category
 *  needs to be walked past this. */
export const MAX_OFFSET = 10_000;
