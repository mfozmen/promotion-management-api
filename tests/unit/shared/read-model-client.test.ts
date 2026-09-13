import { describe, expect, it } from 'vitest';
import { createReadModelClient } from '@src/shared/read-model-client.js';

describe('the storefront client limits its wait on Redis', () => {
  it('fails a command rather than queueing it while the server is away', () => {
    const client = createReadModelClient('redis://localhost:6379', 9);
    const { db, enableOfflineQueue, maxRetriesPerRequest, commandTimeout } = client.options;
    client.disconnect();

    // Offline queueing would hold a request open on the busiest endpoint in
    // the system until it timed out; the routes answer 503 instead.
    expect(enableOfflineQueue).toBe(false);
    expect(maxRetriesPerRequest).toBe(1);
    // A refused connection fails in a round trip on its own; a server that
    // accepts and never replies does not, and without this every storefront
    // request holds an Express socket for as long as the partition lasts. The
    // budget is client-side elapsed time, so it clears the event-loop lag this
    // process shows under load rather than answering 503 because of it.
    expect(commandTimeout).toBe(1_000);
    // The read model's own database, never the queue's (ADR-0003).
    expect(db).toBe(9);
  });
});
