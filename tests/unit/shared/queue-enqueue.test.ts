import { describe, expect, it } from 'vitest';
import type { EventBus } from '@src/shared/event-bus.js';
import { queueEnqueue } from '@src/shared/queue-enqueue.js';

describe('queueEnqueue', () => {
  it('publishes the event and hands the handler back nothing to act on', async () => {
    // Which queue an event lands on is the bus's catalogue, asserted in
    // `event-bus.test.ts`. What this owns is that a handler's `Enqueue` reaches
    // `publish`, and that the job it returns does not leak to the caller — a
    // handler able to read a job id would start depending on one.
    const published: { name: string; payload: unknown }[] = [];
    const bus = {
      publish: (name: string, payload: unknown) => {
        published.push({ name, payload });
        return Promise.resolve({ id: '1' });
      },
    } as unknown as EventBus;

    const result = await queueEnqueue(bus)('promotion.changed', { promotionId: 7 });

    expect(published).toEqual([{ name: 'promotion.changed', payload: { promotionId: 7 } }]);
    expect(result).toBeUndefined();
  });
});
