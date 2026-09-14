import { describe, expect, it, vi } from 'vitest';
import { createReadModelWriterClient } from '@src/shared/read-model-writer-client.js';
import { logger } from '@src/shared/logger.js';

describe('createReadModelWriterClient', () => {
  it('waits out a reconnect rather than failing a rebuild page', () => {
    const client = createReadModelWriterClient('redis://localhost:6379', 9);
    const { db, enableOfflineQueue, maxRetriesPerRequest, commandTimeout } = client.options;
    client.disconnect();

    // The storefront's limits are wrong here: a page of a hundred thousand
    // products should outlive a restart, where a request someone is waiting on
    // should not.
    expect(enableOfflineQueue).toBe(true);
    expect(maxRetriesPerRequest).not.toBe(1);
    expect(commandTimeout).toBeUndefined();
    expect(db).toBe(9);
  });

  it('logs a connection failure rather than letting ioredis print outside pino', () => {
    // Observed live: both workers printed "[ioredis] Unhandled error event" as raw
    // text through a Redis restart, in the two processes that write the read model.
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const client = createReadModelWriterClient('redis://localhost:6379', 9);

    client.emit('error', new Error('connect ECONNREFUSED'));
    client.disconnect();

    expect(error).toHaveBeenCalledWith(
      { err: expect.any(Error) as Error },
      'read model writer client failed',
    );
  });
});
