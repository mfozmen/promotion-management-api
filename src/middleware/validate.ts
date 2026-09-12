import type { RequestHandler } from 'express';
import type { ZodError, ZodObject } from 'zod';
import { AppError } from '../shared/http-error.js';

export interface RequestSchemas {
  body?: ZodObject;
  query?: ZodObject;
  params?: ZodObject;
}

const PARTS = ['body', 'query', 'params'] as const;

const details = (error: ZodError): { path: string; message: string }[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/**
 * Parses each declared part and replaces it with the typed result, so a handler
 * reads raw input only where it declared no schema.
 *
 * Schemas are made strict here rather than per request, both to keep the hot
 * path free of schema work and because an unknown field must be a 400: a
 * misspelled `catgeory` filter returning the unfiltered catalogue is the worse
 * failure. `.strict()` reaches the top level only — a nested object declares
 * `z.strictObject(...)` itself, or a field misspelled inside it is dropped in
 * silence.
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
        next(
          new AppError(400, 'VALIDATION_ERROR', `Invalid request ${part}`, details(result.error)),
        );

        return;
      }
      // `req.query` is a getter in Express 5; an own property shadows it.
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
