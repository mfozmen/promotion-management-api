import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { readModelConsumer } from '@src/modules/storefront/read-model-consumer.js';
import { ProductUpsertedHandler } from '@src/modules/storefront/events/product-upserted-handler.js';
import { PromotionChangedHandler } from '@src/modules/storefront/events/promotion-changed-handler.js';
import { ReadModelRebuildHandler } from '@src/modules/storefront/events/readmodel-rebuild-handler.js';
import type { Db } from '@src/shared/db/client.js';
import { captureLogger } from '../../capture-logger.js';

const rules = [
  {
    id: 1,
    type: 'promotion' as const,
    name: 'product-only',
    conditions: { all: [{ fact: 'productPriceCents', operator: 'notEqual', value: null }] },
    event: { type: 'selectCandidate', params: { level: 'product' } },
    priority: 30,
    active: true,
    updatedAt: new Date(),
  },
];

const db = { select: () => ({ from: () => Promise.resolve(rules) }) } as unknown as Db;
const redis = {
  defineCommand: () => undefined,
  exists: () => Promise.resolve(1),
} as unknown as Redis;
const queue = { publish: () => Promise.resolve(undefined) };

describe('readModelConsumer', () => {
  it('builds every consumer the read model needs from the two stores', async () => {
    const consumer = await readModelConsumer(db, redis, queue, captureLogger().logger);

    expect(consumer.upserted).toBeInstanceOf(ProductUpsertedHandler);
    expect(consumer.promotionChanged).toBeInstanceOf(PromotionChangedHandler);
    expect(consumer.rebuild).toBeInstanceOf(ReadModelRebuildHandler);
    await expect(consumer.rebuildOnBoot()).resolves.toBe(false);
  });

  it('refuses to start when the policy has no rule to read', async () => {
    const empty = { select: () => ({ from: () => Promise.resolve([]) }) } as unknown as Db;

    await expect(readModelConsumer(empty, redis, queue, captureLogger().logger)).rejects.toThrow(
      /no active promotion rules/,
    );
  });
});
