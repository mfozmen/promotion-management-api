import { describe, expect, it } from 'vitest';
import { queueOfEvent } from '@src/shared/queue-of-event.js';

describe('queueOfEvent', () => {
  it('gives each urgency class its own queue', () => {
    expect(queueOfEvent).toEqual({
      'promotion.changed': 'promotions',
      'product.upserted': 'catalog',
      'ingestion.chunk': 'ingestion',
      'readmodel.rebuild': 'maintenance',
      'reconcile.run': 'maintenance',
    });
  });

  it('keeps a flash sale off every queue a bulk import or a rebuild writes to', () => {
    const bulk = [
      queueOfEvent['product.upserted'],
      queueOfEvent['ingestion.chunk'],
      queueOfEvent['readmodel.rebuild'],
    ];

    expect(bulk).not.toContain(queueOfEvent['promotion.changed']);
  });
});
