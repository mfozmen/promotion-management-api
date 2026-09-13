/** A category becomes a Redis key on the busiest path in the system and its
 *  length is the caller's to choose, so the request bounds it. Generous rather
 *  than tight on purpose: `products.category` is unbounded `text` and the
 *  ingestion path validates no maximum, so a bound a real category could reach
 *  would answer 400 for the one category a flash sale is running on. The
 *  column is the side that should move — a check there, with this derived from
 *  it — which is the story that owns writing categories, not this reader. */
export const MAX_CATEGORY = 256;
