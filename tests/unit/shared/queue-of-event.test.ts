import { describe, expect, it } from 'vitest';
import { queueOfEvent } from '@src/shared/queue-of-event.js';

describe('queueOfEvent', () => {

  it('routes ingestion.chunk to the ingestion queue and every other event to events', () => {
    expect(queueOfEvent).toEqual({
      'product.upserted': 'events',
      'promotion.changed': 'events',
      'readmodel.rebuild': 'events',
      'reconcile.run': 'events',
      'ingestion.chunk': 'ingestion',
    });
  });
});
