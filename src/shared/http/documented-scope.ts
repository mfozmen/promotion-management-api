/** The scrape and the board answer neither this API's envelope nor its content
 *  type, and the documentation page serves HTML. */
export function isDocumented(path: string): boolean {
  return path.startsWith('/api') && !path.startsWith('/api/docs');
}
