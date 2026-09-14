import { sql } from 'drizzle-orm';

interface Store {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

interface ReadModel {
  ping(): Promise<unknown>;
}

export interface DependencyStatus {
  postgres: 'up' | 'down';
  redis: 'up' | 'down';
}

/**
 * Whether this process can reach its two stores right now. It asks them rather
 * than reading a flag: a pool that was built holds no connection, so nothing on
 * this side knows a store is gone until a query fails.
 */
export class DependencyReadiness {
  constructor(
    private readonly store: Store,
    private readonly readModel: ReadModel,
  ) {}

  async check(): Promise<DependencyStatus> {
    const [postgres, redis] = await Promise.all([
      this.reached(this.store.execute(sql`select 1`)),
      this.reached(this.readModel.ping()),
    ]);

    return { postgres, redis };
  }

  /** A refused connection, a timeout and a wrong password all mean the same thing
   *  to a caller deciding whether to send traffic here. */
  private async reached(reply: Promise<unknown>): Promise<'up' | 'down'> {
    try {
      await reply;

      return 'up';
    } catch {
      return 'down';
    }
  }
}
