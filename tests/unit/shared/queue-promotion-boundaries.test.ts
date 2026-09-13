import { describe, expect, it } from 'vitest';
import type { Queues } from '@src/shared/queue.js';
import { queuePromotionBoundaries } from '@src/shared/queue-promotion-boundaries.js';

/**
 * The adapter is the whole gap between a handler and BullMQ, and it is the one
 * piece `src/server.ts` cannot prove because that file is excluded from
 * coverage. So the deterministic job id and the delay are pinned here.
 */
const recordingQueues = () => {
  const added: { id?: string; delay?: number }[] = [];
  const removed: string[] = [];
  const events = {
    add: (_name: string, _payload: unknown, opts: { jobId?: string; delay?: number }) => {
      added.push({ id: opts.jobId, delay: opts.delay });
      return Promise.resolve({ id: opts.jobId });
    },
    remove: (id: string) => {
      removed.push(id);
      return Promise.resolve(1);
    },
  };
  return { queues: { events, ingestion: events } as unknown as Queues, added, removed };
};

describe('queuePromotionBoundaries', () => {
  it('schedules an activate for the gap between now and the start', async () => {
    const { queues, added } = recordingQueues();
    const now = new Date('2026-09-13T00:00:00.000Z');
    const at = new Date('2026-09-13T01:00:00.000Z');

    await queuePromotionBoundaries(queues).schedule(7, 'activate', at, now);

    expect(added).toEqual([{ id: 'promo:7:activate', delay: 3_600_000 }]);
  });

  it('removes both boundary jobs for a promotion', async () => {
    const { queues, removed } = recordingQueues();

    await queuePromotionBoundaries(queues).remove(7);

    expect(removed).toEqual(['promo:7:activate', 'promo:7:expire']);
  });
});
