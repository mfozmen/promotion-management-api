import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { listProducts } from '@src/modules/product/db/list-products.js';
import { HttpError } from '@src/shared/http/http-error.js';

const page = { order: 'asc', page: 1, pageSize: 20 } as const;

/** A client that answers the gate and then fails, which is the window a Redis
 *  failover opens on every request in flight. */
function failingAfterGate(failure: Error): Redis {
  return {
    zrange: () => Promise.reject(failure),
    zcard: () => Promise.reject(failure),
    pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.reject(failure) }),
  } as unknown as Redis;
}

describe('listProducts', () => {
  it('answers come back rather than server fault when Redis drops mid-request', async () => {
    const failure = Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });

    const raised = await listProducts(failingAfterGate(failure), page).catch(
      (error: unknown) => error,
    );

    // The readiness gate maps this; the page read did not, so a failover one
    // round trip later answered 500 and invited an immediate retry.
    expect(raised).toBeInstanceOf(HttpError);
    expect((raised as HttpError).code).toBe('READ_MODEL_NOT_READY');
    expect((raised as HttpError).cause).toBe(failure);
  });

  it('reads the failure a pipeline resolves with rather than waiting to be rejected', async () => {
    // Probed against the installed ioredis: `exec` resolves with
    // `[[Error, null]]` for a connection that has gone, and rejects only for
    // shapes this client cannot produce. A test written against a rejection is
    // green while production answers 500.
    const failure = new Error("Stream isn't writeable and enableOfflineQueue options is false");
    const redis = {
      zrange: () => Promise.resolve(['1']),
      zcard: () => Promise.resolve(1),
      pipeline: () => ({
        hgetall: () => undefined,
        exec: () => Promise.resolve([[failure, null]]),
      }),
    } as unknown as Redis;

    const raised = await listProducts(redis, page).catch((error: unknown) => error);

    expect(raised).toBeInstanceOf(HttpError);
    expect((raised as HttpError).code).toBe('READ_MODEL_NOT_READY');
  });

  it('never names a key the caller composed, even on the branch that names keys', async () => {
    const wrongType = Object.assign(new Error('WRONGTYPE Operation against a key'), {
      name: 'ReplyError',
    });
    const redis = {
      zrange: () => Promise.reject(wrongType),
      zcard: () => Promise.reject(wrongType),
      pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve([]) }),
    } as unknown as Redis;

    const raised = await listProducts(redis, {
      ...page,
      category: 'boots at product:7',
    }).catch((error: unknown) => error);

    // A key existing with the wrong type is the writer's doing; the string
    // still came from the query parameter, so an operator would read a
    // product id the caller invented.
    expect((raised as Error).message).not.toContain('product:7');
    // The branch as well as the absence: a 503 would satisfy the line above
    // while proving nothing about the one that names keys.
    expect(raised).toBe(wrongType);
  });

  it('leaves a reply error a server fault, because the server answered', async () => {
    // WRONGTYPE on a product key is the writer having written something else
    // there, not Redis being unreachable, and 503 would tell a client to retry
    // a request that cannot start working.
    const replyError = Object.assign(new Error('WRONGTYPE Operation against a key'), {
      name: 'ReplyError',
    });
    const redis = {
      zrange: () => Promise.resolve(['1']),
      zcard: () => Promise.resolve(1),
      pipeline: () => ({
        hgetall: () => undefined,
        exec: () => Promise.resolve([[replyError, null]]),
      }),
    } as unknown as Redis;

    const raised = await listProducts(redis, page).catch((error: unknown) => error);

    expect((raised as Error).name).toBe('ReplyError');
    // Which key: the operator otherwise reads "against a key holding the wrong
    // kind of value" and goes looking through fifty thousand of them.
    expect((raised as Error).message).toContain('product:1');
  });

  it('leaves a malformed row a server fault, because that price is wrong rather than absent', async () => {
    const redis = {
      zrange: () => Promise.resolve(['1']),
      zcard: () => Promise.resolve(1),
      pipeline: () => ({
        hgetall: () => undefined,
        exec: () => Promise.resolve([[null, { id: '1', name: 'no prices here' }]]),
      }),
    } as unknown as Redis;

    const raised = await listProducts(redis, page).catch((error: unknown) => error);

    expect(raised).not.toBeInstanceOf(HttpError);
  });
});
