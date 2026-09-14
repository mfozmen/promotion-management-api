import type { RequestHandler } from 'express';
import type { ZodObject } from 'zod';
import createError from 'http-errors';

const PARTS = ['body', 'query', 'params'] as const;

/** Declared parts only, and a `params` schema goes on the route rather than the
 *  router: Express fills `req.params` per layer match (ADR-0009). */
export function validate(schemas: {
  body?: ZodObject;
  query?: ZodObject;
  params?: ZodObject;
}): RequestHandler {
  const strict = PARTS.flatMap((part) => {
    const schema = schemas[part];

    return schema ? [[part, schema.strict()] as const] : [];
  });

  const handler: RequestHandler = (req, _res, next) => {
    for (const [part, schema] of strict) {
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        next(createError(400, `Invalid request ${part}`));

        return;
      }
      // Plain assignment throws: `query` is a prototype getter in Express 5.
      Object.defineProperty(req, part, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    next();
  };
  // What the route accepts, where `route-inventory.ts` can read it.
  (handler as unknown as Record<symbol, unknown>)[Symbol.for('pma.validates')] = schemas;

  return handler;
}
