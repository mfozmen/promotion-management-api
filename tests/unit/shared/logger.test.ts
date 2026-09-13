import { describe, expect, it } from 'vitest';
import { logger } from '@src/shared/logger.js';
import { serializeError } from '@src/shared/serialize-error.js';

/** What `pino.symbols.serializersSym` is; the constant is not in pino's published types. */
const SERIALIZERS = Symbol.for('pino.serializers');

describe('logger', () => {
  // The scrubber only scrubs what it is attached to. A serializer written, tested and never
  // wired passes every test about itself while production writes pino's default line.
  it('runs the error serializer, so a driver error cannot reach a line unscrubbed', () => {
    const attached = (logger as unknown as Record<symbol, Record<string, unknown> | undefined>)[
      SERIALIZERS
    ];

    expect(attached?.['err']).toBe(serializeError);
  });
});
