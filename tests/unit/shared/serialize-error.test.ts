import { describe, expect, it } from 'vitest';
import { serializeError } from '@src/shared/serialize-error.js';

describe('serializeError', () => {
  it('emits the four whitelisted keys and nothing else', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    expect(Object.keys(serializeError(err)).sort()).toEqual(['code', 'message', 'stack', 'type']);
  });

  it('carries the type, the message and the code an operator needs', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    expect(serializeError(err)).toMatchObject({
      type: 'Error',
      message: 'connect ECONNREFUSED',
      code: 'ECONNREFUSED',
    });
  });

  it('bounds the message, which a caller can make long', () => {
    expect(serializeError(new Error('x'.repeat(500))).message).toHaveLength(200);
  });

  it('omits the code when the error carries none, and when it is not a string', () => {
    expect(serializeError(new Error('plain')).code).toBeUndefined();
    expect(serializeError(Object.assign(new Error('odd'), { code: 500 })).code).toBeUndefined();
  });

  it('reports the type of a thrown non-error, never its value', () => {
    expect(serializeError({ password: 'hunter2' })).toEqual({ type: 'object' });
  });
});
