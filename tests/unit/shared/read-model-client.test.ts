import { describe, expect, it } from 'vitest';
import { createReadModelClient } from '@src/shared/read-model-client.js';

describe('the storefront client limits its wait on Redis', () => {
  it('fails a command rather than queueing it while the server is away', () => {
    const client = createReadModelClient('redis://localhost:6379', 9);
    const { db, enableOfflineQueue, maxRetriesPerRequest } = client.options;
    client.disconnect();

    // Offline queueing would hold a request open on the busiest endpoint in
    // the system until it timed out; the routes answer 503 instead.
    expect(enableOfflineQueue).toBe(false);
    expect(maxRetriesPerRequest).toBe(1);
    // The read model's own database, never the queue's (ADR-0003).
    expect(db).toBe(9);
  });
});
