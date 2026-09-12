import type { RequestHandler } from 'express';
import type { ZodError, ZodObject } from 'zod';
import { HttpError } from '../shared/http-error.js';
import { logger } from '../shared/logger.js';

export interface RequestSchemas {
  body?: ZodObject;
  query?: ZodObject;
  params?: ZodObject;
}

const PARTS = ['body', 'query', 'params'] as const;

/**
 * A rejection names where the problem is, never what the client sent: the path
 * is ours and they need it, the key and the value are theirs. zod quotes the
 * offending key in its message, so that issue is reworded and the key is logged
 * instead.
 *
 * The path is ours only while no schema has client-controlled keys: a
 * `z.record` part would put the caller's own key into `path`, reopening this.
 * A union's detail is also only as good as its top-level message today.
 */
/** `body.items[3].sku`: the part it was found in, then the way in. */
const formatPath = (part: string, path: PropertyKey[]): string =>
  path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number' ? `${acc}[${segment}]` : `${acc}.${String(segment)}`,
    part,
  );

function toDetails(error: ZodError, part: string): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: formatPath(part, issue.path),
    message:
      issue.code === 'unrecognized_keys'
        ? `Unrecognized fields are not accepted here: ${issue.keys.length}`
        : issue.message,
  }));
}

const rejectedKeys = (error: ZodError): string[] =>
  error.issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []));

/**
 * Declared parts only: a part with no schema reaches the handler raw.
 *
 * Callers own nested strictness — `.strict()` reaches the top level only, so a
 * nested object declares `z.strictObject(...)` itself or a field misspelled
 * inside it is dropped in silence (ADR-0008).
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  const strict = PARTS.flatMap((part) => {
    const schema = schemas[part];

    return schema ? [[part, schema.strict()] as const] : [];
  });

  return (req, _res, next) => {
    for (const [part, schema] of strict) {
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const keys = rejectedKeys(result.error);
        if (keys.length > 0) {
          // `warn`, not `debug`: the default level is `info`, so a debug line
          // would be the mitigation that never fires. Names, never values, and
          // bounded in count and in length, because both are the client's to
          // choose and this line is written on an unauthenticated path.
          (req.log ?? logger).warn(
            { part, keys: keys.slice(0, 20).map((key) => key.slice(0, 64)), count: keys.length },
            'unrecognized fields rejected',
          );
        }
        next(
          new HttpError(
            400,
            'VALIDATION_ERROR',
            `Invalid request ${part}`,
            toDetails(result.error, part),
          ),
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
