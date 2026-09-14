import type { Redis } from 'ioredis';
import { ProductReadRepository } from './product-read-repository.js';

export interface ProductEntry {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  effectivePriceCents: number;
  stockQuantity: number;
  promotionId?: number;
  promotionName?: string;
  pricingRulesVersion?: number;
}

/** A token is `<epoch microseconds>:<category>`, the category empty once the
 *  product is gone. Microseconds stay exact as Lua numbers until the year 2255. */
const READ_TOKEN = `
local tokens = KEYS[1]
local id = ARGV[1]
local sourceReadAt = ARGV[2]
local wasCategoryKey = ARGV[3]

local token = redis.call('HGET', tokens, id)
local wasCategory = ''
if token then
  local colon = string.find(token, ':', 1, true)
  if tonumber(string.sub(token, 1, colon - 1)) >= tonumber(sourceReadAt) then return 0 end
  wasCategory = string.sub(token, colon + 1)
end
`;

/** Entry, both memberships and token move together, so a reader never sees one
 *  recompute's price beside another's score. */
const WRITE = `${READ_TOKEN}
local entry = KEYS[2]
local category = KEYS[3]
local allProducts = KEYS[4]
local price = ARGV[4]
local categoryName = ARGV[5]

if wasCategory ~= '' and wasCategory ~= categoryName then
  redis.call('ZREM', wasCategoryKey .. wasCategory, id)
end
redis.call('HSET', tokens, id, sourceReadAt .. ':' .. categoryName)
redis.call('DEL', entry)
redis.call('HSET', entry, unpack(ARGV, 6))
redis.call('ZADD', category, price, id)
redis.call('ZADD', allProducts, price, id)
return 1
`;

/** The token outlives the entry, which is what makes a delete a tombstone: an
 *  absent token means never written (ADR-0003). */
const REMOVE = `${READ_TOKEN}
local entry = KEYS[2]
local allProducts = KEYS[3]

if wasCategory ~= '' then
  redis.call('ZREM', wasCategoryKey .. wasCategory, id)
end
redis.call('HSET', tokens, id, sourceReadAt .. ':')
redis.call('DEL', entry)
redis.call('ZREM', allProducts, id)
return 1
`;

export class ProductWriteRepository {
  /** One hash for every token rather than a key per product: the read path never
   *  sees it, and a catalogue costs one key instead of one per product. */
  static readonly TOKENS = 'readmodel:source-read-at';

  /** The chunk the spec asks for: a pipeline of a million commands is one reply
   *  array held in memory on both ends. */
  static readonly CHUNK = 1_000;

  constructor(private readonly redis: Redis) {
    // Sends each body once and calls it by SHA afterwards.
    redis.defineCommand('writeProductEntry', { numberOfKeys: 4, lua: WRITE });
    redis.defineCommand('removeProductEntry', { numberOfKeys: 3, lua: REMOVE });
  }

  /** One round trip per thousand products, never one per product. Each answer
   *  is false when an equal or later token already stood: that caller's read of
   *  PostgreSQL was not the newest. */
  async writeAll(entries: readonly ProductEntry[], sourceReadAt: string): Promise<boolean[]> {
    return this.appliedAll(
      'writeProductEntry',
      entries.map((entry) => [
        ProductWriteRepository.TOKENS,
        ProductReadRepository.productKey(entry.id),
        ProductReadRepository.categoryKey(entry.category),
        ProductReadRepository.ALL_PRODUCTS,
        String(entry.id),
        sourceReadAt,
        // The key the product may be leaving is not known until Lua reads the
        // token, so the prefix travels and the name is joined there.
        ProductReadRepository.categoryKey(''),
        String(entry.effectivePriceCents),
        entry.category,
        ...ProductWriteRepository.fieldsOf(entry, sourceReadAt),
      ]),
    );
  }

  /** The category comes from the token rather than the caller: a row PostgreSQL
   *  no longer holds cannot say which set it was scored in. */
  async removeAll(ids: readonly number[], sourceReadAt: string): Promise<boolean[]> {
    return this.appliedAll(
      'removeProductEntry',
      ids.map((id) => [
        ProductWriteRepository.TOKENS,
        ProductReadRepository.productKey(id),
        ProductReadRepository.ALL_PRODUCTS,
        String(id),
        sourceReadAt,
        ProductReadRepository.categoryKey(''),
      ]),
    );
  }

  async write(entry: ProductEntry, sourceReadAt: string): Promise<boolean> {
    return (await this.writeAll([entry], sourceReadAt))[0]!;
  }

  async remove(id: number, sourceReadAt: string): Promise<boolean> {
    return (await this.removeAll([id], sourceReadAt))[0]!;
  }

  /** `updatedAt` is rendered from the token, so the entry carries one clock and
   *  it is the database's. */
  private static fieldsOf(entry: ProductEntry, sourceReadAt: string): string[] {
    const fields = [
      'id',
      String(entry.id),
      'sku',
      entry.sku,
      'name',
      entry.name,
      'category',
      entry.category,
      'basePriceCents',
      String(entry.basePriceCents),
      'effectivePriceCents',
      String(entry.effectivePriceCents),
      'stockQuantity',
      String(entry.stockQuantity),
      'updatedAt',
      new Date(Number(sourceReadAt) / 1000).toISOString(),
    ];
    // Both or neither (ADR-0006).
    if (entry.promotionId !== undefined && entry.promotionName !== undefined) {
      fields.push('promotionId', String(entry.promotionId), 'promotionName', entry.promotionName);
    }
    if (entry.pricingRulesVersion !== undefined) {
      fields.push('pricingRulesVersion', String(entry.pricingRulesVersion));
    }

    return fields;
  }

  /** `defineCommand` adds the method at runtime, which the ioredis types do not
   *  see; the script returns 0 when an equal or later token already stood. */
  private async appliedAll(name: string, calls: string[][]): Promise<boolean[]> {
    const applied: boolean[] = [];

    for (let from = 0; from < calls.length; from += ProductWriteRepository.CHUNK) {
      const chunk = calls.slice(from, from + ProductWriteRepository.CHUNK);
      const pipeline = this.redis.pipeline();
      const queue = pipeline as unknown as Record<string, (...a: string[]) => unknown>;
      for (const args of chunk) queue[name]!.call(pipeline, ...args);

      // `exec` resolves with each reply's error rather than rejecting, so a
      // failed script in the middle of a pipeline is only visible here.
      const replies = (await pipeline.exec()) ?? [];
      for (const [error, reply] of replies) {
        if (error !== null) throw error;
        applied.push(reply === 1);
      }
    }

    return applied;
  }
}
