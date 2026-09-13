/** A category is a label an operator types, not a document. It becomes a Redis
 *  key on the busiest path in the system and its length is the caller's to
 *  choose, so the bound is the schema's rather than Redis's. */
export const MAX_CATEGORY = 64;
