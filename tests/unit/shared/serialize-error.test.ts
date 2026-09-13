import { describe, expect, it } from 'vitest';
import { serializeError } from '@src/shared/serialize-error.js';
import { captureLogger } from '../capture-logger.js';

describe('serializeError', () => {
  // The control case. A scrubber that strips everything passes every leak assertion and is
  // useless; only this one tells the two apart.
  it('leaves an ordinary error alone', () => {
    const error = new Error('read model not ready');

    const serialized = serializeError(error);

    expect(serialized.type).toBe('Error');
    expect(serialized.message).toBe('read model not ready');
    expect(serialized.code).toBeUndefined();
    expect(serialized.constraint).toBeUndefined();
  });

  it('keeps a stack that carries no message exactly as it is', () => {
    const error = new Error('boom');
    error.stack = '    at doThing (/app/src/thing.ts:4:11)\n    at next (/app/src/other.ts:9:3)';

    expect(serializeError(error).stack).toBe(error.stack);
  });

  it('drops the message lines from a stack and keeps the frames', () => {
    const error = new Error('Failed query: select 1\nparams: sk-live-SECRET');
    error.stack = `Error: Failed query: select 1\nparams: sk-live-SECRET\n    at q (/app/src/q.ts:1:1)\ncaused by: error: duplicate key\n    at pg (/app/node_modules/pg/index.js:2:2)`;

    const stack = serializeError(error).stack ?? '';

    expect(stack).not.toContain('sk-live-SECRET');
    expect(stack).not.toContain('select 1');
    expect(stack).toContain('at q (/app/src/q.ts:1:1)');
    // The frames below `caused by:` locate the driver call and carry no message of their own.
    expect(stack).toContain('at pg (/app/node_modules/pg/index.js:2:2)');
  });

  it('says nothing about the statement when the error carries one', () => {
    const error = Object.assign(new Error('Failed query: insert into products\nparams: SECRET'), {
      query: 'insert into products (sku) values ($1)',
      params: ['SECRET'],
      cause: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'products_sku_unique',
      }),
    });

    const serialized = serializeError(error);

    expect(JSON.stringify(serialized)).not.toContain('SECRET');
    expect(JSON.stringify(serialized)).not.toContain('insert into products');
    expect(serialized.code).toBe('23505');
    expect(serialized.constraint).toBe('products_sku_unique');
  });

  it('handles a cause chain that loops without hanging', () => {
    const outer: Error & { cause?: unknown } = new Error('outer');
    const inner: Error & { cause?: unknown } = new Error('inner');
    outer.cause = inner;
    inner.cause = outer;

    expect(() => serializeError(outer)).not.toThrow();
  });

  it.each([
    ['a stack that is only its message', 'Error: boom'],
    ['no stack at all', undefined],
  ])('omits the stack rather than emitting an empty one for %s', (_case, stack) => {
    // The message line is the one thing dropped, so an error carrying nothing else has no
    // frames left; an empty `stack: ""` in the line would read as a stack that was captured.
    const error = new Error('boom');
    error.stack = stack;

    expect(serializeError(error)).not.toHaveProperty('stack');
  });

  it('reports the failure rather than throwing when the error resists inspection', () => {
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('message getter');
      },
    });

    expect(serializeError(hostile)).toEqual({
      type: 'UnserializableError',
      message: 'error could not be serialized',
    });
  });

  it('still writes a line when the error resists inspection', () => {
    // Measured, not assumed: pino does not catch a throwing serializer. The log call throws and
    // no line is written at all, so a scrubber that propagates deletes the diagnostic it exists
    // to protect. This is the assertion that the protection survives its own failure.
    const { logger, lines } = captureLogger();
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'stack', {
      get: () => {
        throw new Error('stack getter');
      },
    });

    expect(() => logger.error({ err: hostile }, 'unhandled error')).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.['err']).toEqual({
      type: 'UnserializableError',
      message: 'error could not be serialized',
    });
  });

  it('passes a non-error through rather than pretending it is one', () => {
    expect(serializeError('not an error').message).toBe('not an error');
  });
});
