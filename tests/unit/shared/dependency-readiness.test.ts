import { describe, expect, it, vi } from 'vitest';
import { DependencyReadiness } from '@src/shared/dependency-readiness.js';

const reachable = () => ({ execute: vi.fn().mockResolvedValue([]) });
const answering = () => ({ ping: vi.fn().mockResolvedValue('PONG') });
const refusing = () => Promise.reject(new Error('connect ECONNREFUSED'));

describe('DependencyReadiness', () => {
  it('asks both stores rather than reporting that it holds them', async () => {
    const store = reachable();
    const readModel = answering();

    const status = await new DependencyReadiness(store, readModel).check();

    expect(status).toEqual({ postgres: 'up', redis: 'up' });
    // A pool that was built holds no connection, so only a query answers this.
    expect(store.execute).toHaveBeenCalledOnce();
    expect(readModel.ping).toHaveBeenCalledOnce();
  });

  it.each([
    ['PostgreSQL is refusing', { postgres: 'down', redis: 'up' }, true, false],
    ['Redis is refusing', { postgres: 'up', redis: 'down' }, false, true],
    ['neither answers', { postgres: 'down', redis: 'down' }, true, true],
  ])('reports which store is unreachable when %s', async (_case, expected, dbDown, redisDown) => {
    const store = dbDown ? { execute: refusing } : reachable();
    const readModel = redisDown ? { ping: refusing } : answering();

    expect(await new DependencyReadiness(store, readModel).check()).toEqual(expected);
  });

  it('answers for the store that is up rather than failing on the one that is not', async () => {
    // Both are asked at once, so a store that hangs to its timeout must not decide
    // what the other one said.
    const store = reachable();

    const status = await new DependencyReadiness(store, { ping: refusing }).check();

    expect(status.postgres).toBe('up');
    expect(store.execute).toHaveBeenCalledOnce();
  });
});
