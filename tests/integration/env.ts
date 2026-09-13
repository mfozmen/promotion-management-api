import { createHash, randomUUID } from 'node:crypto';

// `127.0.0.1`, not `localhost`: Node resolves `localhost` to `::1` first and compose
// publishes on IPv4 only, so the connection is refused by an address nothing is listening
// on while the server sits on the same port one family over.
const baseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/promotion';

export const adminUrl = baseUrl;

// A dozen worktrees share one server, so the template is named after this checkout: rebuilding
// it can never drop the template another run is cloning from.
const checkout = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
export const templateDatabase = `pma_test_template_${checkout}`;

// `pma_test_<epoch ms>_<uuid>`. The timestamp is what lets the stale sweep tell a clone
// abandoned by a killed run from one a run in progress still holds open.
export function cloneName(): string {
  return `pma_test_${Date.now()}_${randomUUID().replaceAll('-', '')}`;
}

export function urlFor(database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
