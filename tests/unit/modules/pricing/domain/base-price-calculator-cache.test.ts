import { describe, expect, it, vi } from 'vitest';
import { BasePriceCalculatorCache } from '@src/modules/pricing/domain/base-price-calculator-cache.js';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';

const at = (iso: string) => new Date(iso);

const ruleRow = (
  over: Partial<PricingRuleRow> & Pick<PricingRuleRow, 'name' | 'conditions' | 'event'>,
): PricingRuleRow => ({
  id: 1,
  type: 'ingestion',
  priority: 0,
  active: true,
  updatedAt: at('2026-09-01T00:00:00.000Z'),
  ...over,
});

const always = {
  all: [{ fact: 'vendorPriceCents', operator: 'greaterThanInclusive', value: 0 }],
};

const percent = (bps: number) => ({ type: 'adjustPercentBps', params: { value: bps } });

describe('BasePriceCalculatorCache', () => {
  const rowsAt = (iso: string): PricingRuleRow[] => [
    ruleRow({
      id: 1,
      name: 'markup',
      conditions: always,
      event: percent(1500),
      updatedAt: at(iso),
    }),
  ];

  it('serves the cached rule set within the cache window', async () => {
    const load = vi.fn().mockResolvedValue(rowsAt('2026-09-01T00:00:00.000Z'));
    let now = 1_000_000;
    const loader = new BasePriceCalculatorCache({ source: load, now: () => now });

    const first = await loader.current();
    now += 59_999;
    const second = await loader.current();

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('recompiles once the cache entry has expired', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(rowsAt('2026-09-01T00:00:00.000Z'))
      .mockResolvedValueOnce(rowsAt('2026-09-05T00:00:00.000Z'));
    let now = 1_000_000;
    const loader = new BasePriceCalculatorCache({ source: load, now: () => now });

    const first = await loader.current();
    now += 60_000;
    const second = await loader.current();

    expect(load).toHaveBeenCalledTimes(2);
    expect(second.pricingRulesVersion).toBeGreaterThan(first.pricingRulesVersion);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const load = vi.fn().mockResolvedValue(rowsAt('2026-09-01T00:00:00.000Z'));
    const loader = new BasePriceCalculatorCache({ source: load, now: () => 0 });

    const [a, b] = await Promise.all([loader.current(), loader.current()]);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue(rowsAt('2026-09-01T00:00:00.000Z'));
    const loader = new BasePriceCalculatorCache({ source: load, now: () => 0 });

    await expect(loader.current()).rejects.toThrowError('database down');
    await expect(loader.current()).resolves.toMatchObject({
      pricingRulesVersion: expect.any(Number),
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
