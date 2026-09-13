import { describe, expect, it } from 'vitest';
import { replyFailure } from '@src/modules/product/db/reply-failure.js';
import createError from 'http-errors';

const reply = (message: string) => Object.assign(new Error(message), { name: 'ReplyError' });

describe('replyFailure', () => {
  it('calls a wrong-typed key the writer bug it is', () => {
    const wrongType = reply('WRONGTYPE Operation against a key holding the wrong kind of value');

    expect(replyFailure(wrongType)).toBe(wrongType);
  });

  it.each([
    ['LOADING Redis is loading the dataset in memory', 'a restart replaying its append-only file'],
    ['BUSY Redis is busy running a script', 'a script the server is still running'],
    ['OOM command not allowed when used memory > maxmemory', 'memory pressure'],
    ['MISCONF Redis is configured to save RDB snapshots', 'a failing background save'],
    ['READONLY You cannot write against a read only replica', 'a replica after a failover'],
  ])('calls %s a reason to come back, not a fault', (message) => {
    // Every one of these is a `ReplyError`, so classifying on the class said a
    // restart was a permanent writer bug and answered 500, which nothing
    // retries — on the gate, that is every storefront request for the whole
    // load.
    const raised = replyFailure(reply(message));

    expect(createError.isHttpError(raised)).toBe(true);
    expect((raised as createError.HttpError).status).toBe(503);
  });

  it('calls a transport failure a reason to come back', () => {
    const raised = replyFailure(new Error("Stream isn't writeable"));

    expect((raised as createError.HttpError).status).toBe(503);
  });

  it('passes a transport failure through whole, key or no key', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
    });

    const raised = replyFailure(refused, 'category:knitwear') as createError.HttpError;

    // The key is not evidence here: it names what was being read, not what is
    // broken, and rebuilding the error to carry it loses the driver's own
    // fields.
    expect(raised.cause).toBe(refused);
  });

  it('does not let a caller write the key an operator reads', () => {
    // The listing's key is `category:` plus a query parameter, so attaching it
    // on this branch would put the caller's text in an operator's line — and
    // let them forge ` at product:7` onto the end of it.
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:6379');

    const raised = replyFailure(refused, 'category:boots at product:7') as createError.HttpError;

    expect(JSON.stringify(raised.cause)).not.toContain('product:7');
    expect((raised.cause as Error).message).toBe('connect ECONNREFUSED 127.0.0.1:6379');
  });

  it('does not read a property off something that is not an error', () => {
    // A rejection carrying a non-error would otherwise throw inside the
    // catch that called this, so `next` is never reached and the request
    // hangs rather than answering anything at all.
    const raised = replyFailure('a string, somehow' as unknown as Error);

    expect((raised as createError.HttpError).status).toBe(503);
  });
});
