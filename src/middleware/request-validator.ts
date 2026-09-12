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

const MAX_SHOWN_KEYS = 20;
const MAX_KEY_LENGTH = 64;

/** `body.items[3].sku`: the part it was found in, then the way in. */
const formatPath = (part: string, path: PropertyKey[]): string =>
  path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number'
        ? `${acc}[${segment}]`
        : `${acc}.${String(segment).slice(0, MAX_KEY_LENGTH)}`,
    part,
  );

/**
 * A rejection names where the problem is and which of the caller's own keys it
 * concerns, never a stored value and never a free-form value they sent
 * (the echo policy settled on PR #46; not yet in this repo's REVIEW.md). The
 * distinction is that a key they typed is an identifier
 * they can act on — without it they cannot fix the request — while a value
 * handed back is just their own input returned to them. Keys are truncated
 * rather than omitted at 64 characters and the list is capped, because
 * how many they send is their choice and this runs unauthenticated.
 */
function toDetails(error: ZodError, part: string): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: formatPath(part, issue.path),
    message:
      issue.code === 'unrecognized_keys'
        ? `Unrecognized keys (${issue.keys.length}): ${shownKeys(issue.keys)}`
        : issue.message,
  }));
}

const shownKeys = (keys: readonly string[]): string =>
  keys
    .slice(0, MAX_SHOWN_KEYS)
    .map((key) => JSON.stringify(key.slice(0, MAX_KEY_LENGTH)))
    .join(', ');

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
          // The client is told which keys it got wrong; this line is so a fleet
          // of them misconfigured the same way is visible in one place. `warn`
          // because the default level is `info` and a `debug` line would never
          // be written. Two lines per rejected request on an unauthenticated
          // path, bounded to roughly 1.4 kB by the same caps as the response.
          (req.log ?? logger).warn(
            {
              part,
              keys: keys.slice(0, MAX_SHOWN_KEYS).map((key) => key.slice(0, MAX_KEY_LENGTH)),
              count: keys.length,
            },
            'unrecognized fields rejected',
          );
        }
        next(
          new HttpError(
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
