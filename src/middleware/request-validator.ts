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
 */
function toDetails(error: ZodError, part: string): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : part,
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
          (req.log ?? logger).debug({ part, keys }, 'unrecognized fields rejected');
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
