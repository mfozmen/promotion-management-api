/**
 * What this API serves, and therefore what the document describes. The scrape
 * and the board are mounted outside the prefix because they answer neither this
 * API's envelope nor its content type (ADR-0009), and the documentation page
 * serves HTML. Stated once, because a test restating it would go green when
 * both copies changed together (REVIEW.md 13.16).
 */
export function isDocumented(path: string): boolean {
  return path.startsWith('/api') && !path.startsWith('/api/docs');
}
