import { sql } from 'drizzle-orm';

/**
 * The instant a write committed, as PostgreSQL reports it.
 *
 * Typed `string`, not `Date`: drizzle maps a declared `timestamptz` column, but a
 * raw fragment has no column mapper and arrives as the driver's text. Annotating
 * it `Date` compiles and then throws at the first `getTime()` — which, inside a
 * swallowed announcement, meant no promotion ever activated or expired.
 *
 * One fragment rather than one per writer, so the next write path cannot
 * reintroduce that by copying the wrong half.
 */
export const databaseNow = sql<string>`now()`;
