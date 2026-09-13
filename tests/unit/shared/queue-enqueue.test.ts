import { describe, expect, it } from 'vitest';
import { queueEnqueue } from '@src/shared/queue-enqueue.js';
import type { Queues } from '@src/shared/queue.js';

describe('queueEnqueue', () => {
  it('puts the event on the queue its catalogue entry names', async () => {
    const added: { name: string; payload: unknown }[] = [];
    const events = {
      add: (name: string, payload: unknown) => {
        added.push({ name, payload });
        return Promise.resolve({ id: '1' });
      },
    };
    const queues = { events, ingestion: events } as unknown as Queues;

    await queueEnqueue(queues)('promotion.changed', { promotionId: 7 });

    expect(added).toEqual([{ name: 'promotion.changed', payload: { promotionId: 7 } }]);
  });
});
