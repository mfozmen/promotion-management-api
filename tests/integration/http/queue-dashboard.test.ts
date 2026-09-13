import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import { appDeps } from '@tests/app-deps.js';
import { EventQueue } from '@src/shared/queue/event-queue.js';
import { eventRegistry } from '@src/events/event-registry.js';
import { eventRouting } from '@src/events/event-routing.js';

const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/9';

describe('the queue dashboard', () => {
  it('serves BullMQ its own board at /admin/queues, outside the api prefix', async () => {
    const queue = EventQueue.connect(redisUrl, 15, eventRegistry, eventRouting, 'board-test');
    try {
      const res = await request(createApp(appDeps({ queues: queue }))).get(
        '/admin/queues/api/queues',
      );

      expect(res.status).toBe(200);
      expect(res.body.queues.map((q: { name: string }) => q.name).sort()).toEqual(
        [...new Set(Object.values(eventRouting))].sort(),
      );
    } finally {
      await queue.close();
    }
  });
});
