import type { RequestHandler } from 'express';
import type { ZodError, ZodObject } from 'zod';
import createError from 'http-errors';

const PARTS = ['body', 'query', 'params'] as const;

/** Measured, not assumed: the largest body the 100 kB cap allows, made entirely of
 *  failing array items, is 9 998 issues and a 909 kB response — nine times the request,
 *  unauthenticated. The body cap bounds the request and amplifies into the response. */
const MAX_DETAILS = 20;

const formatPath = (part: string, path: PropertyKey[]): string =>
  path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number' ? `${acc}[${segment}]` : `${acc}.${String(segment)}`,
    part,
  );

/** Names the caller's own keys and never the values they sent. */
function toDetails(error: ZodError, part: string): { path: string; message: string }[] {
  return error.issues.slice(0, MAX_DETAILS).map((issue) => ({
    path: formatPath(part, issue.path),
    message:
      issue.code === 'unrecognized_keys'
        ? `Unrecognized keys: ${issue.keys.map((key) => JSON.stringify(key)).join(', ')}`
        : issue.message,
  }));
}

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

  return (req, _res, next) => {
    for (const [part, schema] of strict) {
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        next(
          createError(400, `Invalid request ${part}`, {
            details: toDetails(result.error, part),
          }),
        );

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
}
