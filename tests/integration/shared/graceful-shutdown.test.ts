import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import { EventBus } from '@src/shared/event-bus.js';
import { GracefulShutdown } from '@src/shared/graceful-shutdown.js';

const QUEUE_DB = 1;
const redisUrl = process.env.QUEUE_TEST_REDIS_URL ?? 'redis://127.0.0.1:6399';

describe('GracefulShutdown', () => {
  // Neither test writes a job, and `shutdown` closes the queues it is given, so
  // there is nothing to clean up afterwards.
  const listening = async (): Promise<{
    server: ReturnType<typeof createApp.prototype.listen>;
    port: number;
  }> => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    return { server, port: (server.address() as AddressInfo).port };
  };

  it('drains when nothing is holding the server open', async () => {
    const { server } = await listening();
    const queues = EventBus.connect(redisUrl, QUEUE_DB);

    await expect(new GracefulShutdown(queues, 5_000).run(server)).resolves.toBe('drained');
  });

  it('forces the exit when a request holds the server past the bound', async () => {
    const { server, port } = await listening();
    const queues = EventBus.connect(redisUrl, QUEUE_DB);

    // A half-sent request: the connection is active, not idle, so `server.close`
    // waits for it and would wait for ever. This is the hang the bound exists for.
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n');

    const startedAt = Date.now();
    await expect(new GracefulShutdown(queues, 100).run(server)).resolves.toBe('forced');
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    socket.destroy();
    server.closeAllConnections();
  });
});
