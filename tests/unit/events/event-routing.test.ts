import { describe, expect, it } from 'vitest';
import { eventRouting } from '@src/events/event-routing.js';

describe('eventRouting', () => {
  it('gives each urgency class its own queue', () => {
    expect(eventRouting).toEqual({
      'promotion.changed': 'promotions',
      'product.upserted': 'catalog',
      'ingestion.chunk': 'ingestion',
      'readmodel.rebuild': 'maintenance',
      'reconciler.run': 'maintenance',
    });
  });

  it('keeps a flash sale off every queue a bulk import or a rebuild writes to', () => {
    const bulk = [
      eventRouting['product.upserted'],
      eventRouting['ingestion.chunk'],
      eventRouting['readmodel.rebuild'],
    ];

    expect(bulk).not.toContain(eventRouting['promotion.changed']);
  });
});
