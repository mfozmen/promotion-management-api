import { describe, expect, it } from 'vitest';
import { routing } from '@src/events/routing.js';

describe('routing', () => {
  it('gives each urgency class its own queue', () => {
    expect(routing).toEqual({
      'promotion.changed': 'promotions',
      'product.upserted': 'catalog',
      'ingestion.chunk': 'ingestion',
      'readmodel.rebuild': 'maintenance',
      'reconcile.run': 'maintenance',
    });
  });

  it('keeps a flash sale off every queue a bulk import or a rebuild writes to', () => {
    const bulk = [
      routing['product.upserted'],
      routing['ingestion.chunk'],
      routing['readmodel.rebuild'],
    ];

    expect(bulk).not.toContain(routing['promotion.changed']);
  });
});
