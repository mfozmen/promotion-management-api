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

/** The instant PostgreSQL read the rows, taken in the same statement as the
 *  SELECT. It orders writes; wall-clock from the worker would not, because two
 *  workers' clocks differ by more than the race it settles. */
export type SourceReadAt = string;

/** One write per product, applied only if this recompute read PostgreSQL later
 *  than whatever last wrote. Whole-write atomicity: the hash, both sorted sets
 *  and the token move together or not at all, so a reader never sees a price
 *  from one recompute beside a score from another.
 *
 *  Rejects on equal, because two recomputes that read at the same instant saw
 *  the same rows and the later arrival carries no new information.
 *
 *  An absent token means never written, never "assume newer" — which is why a
 *  delete leaves its token behind (ADR-0003). */
const WRITE = `
local token = redis.call('HGET', KEYS[1], ARGV[1])
if token and token >= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[2], unpack(cjson.decode(ARGV[3])))
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
redis.call('ZADD', KEYS[4], ARGV[4], ARGV[1])
return 1
`;

/** One write per product removed, under the same token rule: a delete that read
 *  PostgreSQL earlier than the last write must not undo it. The token survives
 *  the hash, which is what makes it a tombstone rather than an absence. */
const REMOVE = `
local token = redis.call('HGET', KEYS[1], ARGV[1])
if token and token >= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('DEL', KEYS[2])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
return 1
`;

export class ProductWriteRepository {
  /** One hash for every token rather than a key per product: a tombstone is a
   *  field that outlives its product, the read path never sees it, and 50 000
   *  products cost one key instead of 50 000. */
  static readonly TOKENS = 'readmodel:source-read-at';

  constructor(private readonly redis: Redis) {}

  /** True when the write applied, false when an equal or later token was
   *  already stored — the caller's read of PostgreSQL was not the newest. */
  async write(entry: ProductEntry, sourceReadAt: SourceReadAt): Promise<boolean> {
    const fields: string[] = [
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
      new Date().toISOString(),
    ];
    // Both or neither: a name without an id names a discount nothing gave, and
    // an id without a name renders a discount with no title (ADR-0006).
    if (entry.promotionId !== undefined && entry.promotionName !== undefined) {
      fields.push('promotionId', String(entry.promotionId), 'promotionName', entry.promotionName);
    }
    if (entry.pricingRulesVersion !== undefined) {
      fields.push('pricingRulesVersion', String(entry.pricingRulesVersion));
    }

    return this.apply(WRITE, entry.id, entry.category, sourceReadAt, [
      JSON.stringify(fields),
      String(entry.effectivePriceCents),
    ]);
  }

  async remove(id: number, category: string, sourceReadAt: SourceReadAt): Promise<boolean> {
    return this.apply(REMOVE, id, category, sourceReadAt, []);
  }

  private async apply(
    script: string,
    id: number,
    category: string,
    sourceReadAt: SourceReadAt,
    extra: string[],
  ): Promise<boolean> {
    const applied = await this.redis.eval(
      script,
      4,
      ProductWriteRepository.TOKENS,
      ProductReadRepository.productKey(id),
      ProductReadRepository.categoryKey(category),
      ProductReadRepository.ALL_PRODUCTS,
      String(id),
      sourceReadAt,
      ...extra,
    );

    return applied === 1;
  }
}
