const baseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/promotion';

export const adminUrl = baseUrl;
export const templateDatabase = 'pma_test_template';

export function urlFor(database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
