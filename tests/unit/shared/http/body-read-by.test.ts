import { describe, expect, it } from 'vitest';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { bodyReadBy } from '@src/shared/http/body-read-by.js';

describe('bodyReadBy', () => {
  it('passes the request through to the handler it marks', () => {
    let reached = false;
    const marked = bodyReadBy(
      ((_req, _res, next) => {
        reached = true;
        next();
      }) as RequestHandler,
      'multipart/form-data: file',
    );

    marked({} as never, {} as never, () => undefined);

    expect(reached).toBe(true);
  });

  it('leaves the handler it was given unmarked, so a shared one stays clean', () => {
    // A handler is a value a caller may reuse. Marking it in place would mark
    // every route holding the same reference, which is a route describing
    // itself with another route's request body.
    const shared: RequestHandler = (_req, _res, next) => next();

    bodyReadBy(shared, 'multipart/form-data: file');

    expect(
      (shared as unknown as Record<symbol, unknown>)[Symbol.for('pma.bodyReadBy')],
    ).toBeUndefined();
  });

  it('refuses an error handler, which wrapping would silently demote', () => {
    // Express decides what is an error handler by arity, so a four-argument
    // handler wrapped into three stops being one and its errors go unhandled.
    // Refused here rather than described in a comment nothing enforces.
    const onError: ErrorRequestHandler = (err, req, res, next) => {
      void [err, req, res, next];
    };

    expect(() => bodyReadBy(onError as unknown as RequestHandler, 'anything')).toThrow(
      /error handler/i,
    );
  });
});
