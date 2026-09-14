import { describe, expect, it } from 'vitest';
import { ProcessChunkCommand } from '@src/modules/ingestion/commands/process-chunk-command.js';
import { productUpserted } from '@src/modules/product/events/product-upserted.js';

describe('the ingestion batch size and the announcement cap', () => {
  it('agree, so a full batch is publishable', () => {
    // Two numbers in two files with nothing between them: the batch the processor
    // fills, and the array `product.upserted` will accept. Raising the batch past
    // the cap turns every full batch into a schema failure at publish time — which
    // is after the rows are committed, where a lost announcement is already
    // unrecoverable (REVIEW.md 13.12).
    const full = Array.from({ length: ProcessChunkCommand.DEFAULT_BATCH_SIZE }, (_, i) => i + 1);

    expect(productUpserted.safeParse({ productIds: full }).success).toBe(true);
  });
});
