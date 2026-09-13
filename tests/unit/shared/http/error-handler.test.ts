import { describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '@src/shared/http/error-handler.js';
import { httpLogger } from '@src/shared/http/http-logger.js';
import { HttpError } from '@src/shared/http/http-error.js';
import { captureLogger, type CapturedLogger } from '../../capture-logger.js';
import { overlapError } from '../../overlap-error.js';

/** An app whose only route throws, so the error middleware can be exercised alone. */
function appThrowing(error: unknown, captured: CapturedLogger = captureLogger()): Express {
  const app = express();
  app.use(httpLogger(captured.logger));
  app.get('/boom', (_req, _res, next) => {
    next(error);
  });
  app.use(errorHandler);

  return app;
}

describe('HttpError mapping', () => {
  it.each([
    [400, 'VALIDATION_ERROR' as const, 'Invalid request body'],
    [404, 'NOT_FOUND' as const, 'Product not found'],
    [409, 'CONFLICT' as const, 'An active promotion already covers this product'],
    [429, 'BACKPRESSURE' as const, 'Too many pending imports'],
  ])('answers %i with its code and message', async (status, code, message) => {
    const res = await request(appThrowing(new HttpError(code, message))).get('/boom');

    expect(res.status).toBe(status);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { code, message } });
  });

  it('never returns the message of a 5xx a handler raised', async () => {
    // Written for an operator, and this one carries a credential and a host.
    const leaky = new HttpError('INTERNAL', 'password hunter2 rejected by 10.0.0.5');
    const res = await request(appThrowing(leaky)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(res.text).not.toContain('hunter2');
    expect(res.text).not.toContain('10.0.0.5');
  });

  it('answers a designed 5xx with our own message, not the operator prose', async () => {
    const res = await request(
      appThrowing(
        new HttpError('READ_MODEL_NOT_READY', 'rebuild started by operator at 10.0.0.5', [
          { path: 'host', message: '10.0.0.5' },
        ]),
      ),
    ).get('/boom');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: 'READ_MODEL_NOT_READY',
        // Not "Internal server error": a 503 tells a human to retry.
        message: 'The read model is not ready yet; retry shortly',
      },
    });
    // `details` is a handler's, and a 5xx handler's words never cross.
    expect(res.body.error).not.toHaveProperty('details');
    expect(res.text).not.toContain('10.0.0.5');
  });

  it('gives a 5xx code with no public wording nothing to say', async () => {
    const res = await request(
      appThrowing(
        new HttpError('INTERNAL', 'upstream 10.0.0.5 refused', [
          { path: 'sql', message: 'select 1' },
        ]),
      ),
    ).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(res.text).not.toContain('10.0.0.5');
    expect(res.text).not.toContain('select 1');
  });

  it('logs a handler-raised 5xx as a server fault, with its message', async () => {
    const captured = captureLogger();
    await request(appThrowing(new HttpError('INTERNAL', 'the wheels came off'), captured)).get(
      '/boom',
    );

    expect(captured.lines.find((line) => line.level === 50)).toMatchObject({
      error: { message: 'the wheels came off' },
    });
  });

  it('tells an unreachable store from a cold start without copying the raised message', async () => {
    const captured = captureLogger();
    const raised = new HttpError('READ_MODEL_NOT_READY', 'The read model cannot be reached');
    raised.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    await request(appThrowing(raised, captured)).get('/boom');

    // The two conditions differ in `type`, `message` and `code` already, so
    // copying the raiser's words onto the line bought nothing and wrote an
    // unredacted string beside the redacted one.
    const line = captured.lines.find((entry) => entry.level === 40);
    expect(line).toMatchObject({ error: { type: 'Error', code: 'ECONNREFUSED' } });
    expect(line).not.toHaveProperty('reason');
  });

  it('does not call come back later a server fault', async () => {
    const captured = captureLogger();
    await request(
      appThrowing(new HttpError('READ_MODEL_NOT_READY', 'rebuild running'), captured),
    ).get('/boom');

    // Every request during a rebuild raises this. At `error` with a stack it
    // is one alertable line per request for an ordinary operating condition,
    // which buries the real 500s ADR-0010 reserves that level for.
    expect(captured.lines.find((line) => line.level === 50)).toBeUndefined();
    expect(captured.lines.find((line) => line.level === 40)).toMatchObject({
      code: 'READ_MODEL_NOT_READY',
      status: 503,
      error: { message: 'rebuild running' },
    });
  });

  it('cannot be given a status that disagrees with its code', () => {
    // The pairing was wrong in three directions across three commits. It is not
    // a rule any more: `new HttpError(404, 'CONFLICT', …)` does not compile, and
    // the status is whatever the code says it is.
    expect(new HttpError('CONFLICT', 'x').status).toBe(409);
    expect(new HttpError('READ_MODEL_NOT_READY', 'x').status).toBe(503);
  });

  it('answers a foreign 404 with the code a missing resource has', async () => {
    // A dependency's `NotFound` fell through to `BAD_REQUEST` under a 404,
    // so a client branching on `code` — which is what the envelope exists for
    // — could not tell a missing resource from a malformed request.
    const foreign = Object.assign(new Error('Not Found'), { status: 404, expose: true });

    const res = await request(appThrowing(foreign)).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers a foreign 409 with the code a conflict has', async () => {
    const foreign = Object.assign(new Error('Conflict'), { status: 409, expose: true });

    expect((await request(appThrowing(foreign)).get('/boom')).body.error.code).toBe('CONFLICT');
  });

  it('bounds each detail message, not just how many there are', async () => {
    const raised = new HttpError('VALIDATION_ERROR', 'Invalid request body', [
      { path: 'body.sku', message: 'x'.repeat(5_000) },
    ]);

    const res = await request(appThrowing(raised)).get('/boom');

    // The count was bounded and each message was not, so twenty details of a
    // schema author's own wording had no size bound at all on an
    // unauthenticated path.
    expect(res.body.error.details[0].message.length).toBe(1_500);
  });

  it('truncates a details list at the envelope, whoever produced it', async () => {
    // The cap lives here now, not in the validator, so it holds for every
    // producer. This is its test, next to the code it bounds.
    const details = Array.from({ length: 21 }, (_, i) => ({ path: `body.f${i}`, message: 'bad' }));
    const res = await request(
      appThrowing(new HttpError('VALIDATION_ERROR', 'Invalid request body', details)),
    ).get('/boom');

    expect(res.body.error.details).toHaveLength(20);
  });

  it('includes details when the error carries them', async () => {
    const details = [{ path: 'page', message: 'Too small' }];
    const res = await request(
      appThrowing(new HttpError('VALIDATION_ERROR', 'Invalid request query', details)),
    ).get('/boom');

    expect(res.body.error.details).toEqual(details);
  });

  it('logs the rejection with the correlation id', async () => {
    const captured = captureLogger();
    await request(appThrowing(new HttpError('CONFLICT', 'Overlap'), captured))
      .get('/boom')
      .set('x-request-id', 'trace-1');

    const rejected = captured.lines.find((line) => line.code === 'CONFLICT');
    expect(rejected).toMatchObject({ status: 409, reqId: 'trace-1' });
  });
});

describe('unexpected errors', () => {
  it('masks the failure as a 500 without internal detail', async () => {
    const res = await request(appThrowing(new Error('connect ECONNREFUSED 10.0.0.1:5432'))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(res.text).not.toContain('ECONNREFUSED');
    expect(res.text).not.toContain('at ');
  });

  it('logs the stack so the failure can be diagnosed', async () => {
    const captured = captureLogger();
    await request(appThrowing(new Error('boom'), captured)).get('/boom');

    const logged = captured.lines.find((line) => line.level === 50);
    expect(logged).toMatchObject({
      error: { message: 'boom', stack: expect.stringContaining('at ') },
    });
  });

  it('logs which code answered a 5xx, so a log line joins to the response', async () => {
    const captured = captureLogger();
    const raised = new HttpError('READ_MODEL_NOT_READY', 'rebuild running');
    // The real `Error.cause`, not the third constructor argument, which is
    // `details`: `serializeError` reads `err.cause` and would never see it there.
    raised.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    await request(appThrowing(raised, captured)).get('/boom');

    // The serialized error reports the cause's code, so without the two
    // top-level fields the line names the driver's failure and never the 503
    // the client read.
    const logged = captured.lines.find((line) => line.level === 40);
    expect(logged).toMatchObject({ code: 'READ_MODEL_NOT_READY', status: 503 });
    expect((logged as { error: { code: string } }).error.code).toBe('ECONNREFUSED');
    // No stack on a line every request writes during an outage.
    expect(logged).not.toHaveProperty('error.stack');
  });

  it('bounds a 4xx message, so a handler cannot mirror a long id back', async () => {
    const res = await request(
      appThrowing(new HttpError('NOT_FOUND', `Product ${'9'.repeat(4_000)} not found`)),
    ).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error.message.length).toBeLessThanOrEqual(200);
  });

  it('tells a client when to come back on the two codes that mean come back later', async () => {
    const res = await request(appThrowing(new HttpError('BACKPRESSURE', 'queue is full'))).get(
      '/boom',
    );

    expect(res.status).toBe(429);
    // A band, not a constant: every client that met the outage retrying in the
    // same second hands the recovering read model its whole backlog at once.
    const after = Number(res.headers['retry-after']);
    expect(after).toBeGreaterThanOrEqual(5);
    expect(after).toBeLessThanOrEqual(10);
  });

  it('spreads the retry hint across clients rather than synchronising them', async () => {
    const hints = new Set<string>();
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await request(appThrowing(new HttpError('BACKPRESSURE', 'queue is full'))).get(
        '/boom',
      );
      hints.add(String(res.headers['retry-after']));
    }

    expect(hints.size).toBeGreaterThan(1);
  });

  it('sends no retry hint on an error retrying cannot fix', async () => {
    const res = await request(appThrowing(new HttpError('NOT_FOUND', 'nope'))).get('/boom');

    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('does not log a statement a wrapper quoted two levels down', async () => {
    const captured = captureLogger();
    const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      query: 'insert into products (sku) values ($1)',
      params: ['SKU-1'],
    });
    // A repository that interpolates the driver's message into its own, then a
    // handler that wraps that: the statement is two causes down, and a walk
    // that takes one step reads the wrapper, which has no query field to spot.
    const wrapped = new Error(
      `upsert failed: ${driverError.message} [${driverError.query}] [${driverError.params[0]}]`,
      { cause: driverError },
    );
    const raised = new HttpError('READ_MODEL_NOT_READY', 'rebuild running');
    raised.cause = wrapped;

    await request(appThrowing(raised, captured)).get('/boom');

    const logged = JSON.stringify(captured.lines);
    expect(logged).not.toContain('insert into products');
    expect(logged).not.toContain('SKU-1');
  });

  it('masks a thrown non-error value and still logs its type', async () => {
    const captured = captureLogger();
    const res = await request(appThrowing('something went wrong', captured)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(captured.lines.find((line) => line.level === 50)).toMatchObject({
      error: { type: 'string' },
    });
  });

  it('masks an error carrying an unmapped type', async () => {
    const res = await request(
      appThrowing(Object.assign(new Error('nope'), { type: 'unknown' })),
    ).get('/boom');

    expect(res.status).toBe(500);
  });
});

describe('an error after the response has started', () => {
  it('does not try to write a second body over the first', async () => {
    const captured = captureLogger();
    const app = express();
    app.use(httpLogger(captured.logger));
    app.get('/stream', (_req, res, next) => {
      res.status(200).type('json').write('{"items":[');
      next(overlapError());
    });
    app.use(errorHandler);

    // The half-written body is not patched up with an error envelope: the
    // connection is destroyed, so the client sees a truncated response and
    // cannot mistake it for a complete one.
    await expect(request(app).get('/stream')).rejects.toThrow(/socket hang up/);

    expect(captured.lines).toContainEqual(
      expect.objectContaining({ msg: 'unhandled error after the response started' }),
    );
    // The path the fix created is a path the whitelist still has to hold on.
    const serialised = JSON.stringify(captured.lines);
    expect(serialised).not.toContain('discount_bp');
    expect(serialised).not.toContain('ayse@example.com');
    expect(serialised).not.toContain('Failed query');
  });
});

describe('log hygiene for driver errors', () => {
  it('logs a driver failure through the whitelist rather than the error itself', async () => {
    const captured = captureLogger();
    await request(appThrowing(overlapError(), captured)).get('/boom');

    const line = captured.lines.find((entry) => entry.level === 50);
    // The handler's own contract: the `error` key, the whitelist's four
    // fields, and no `err` for pino to serialise in full. What the whitelist
    // does with each of them is asserted in serialize-error.test.ts.
    expect(line).not.toHaveProperty('err');
    expect(line).toMatchObject({
      error: { type: 'PostgresError', code: '23P01' },
    });
    expect(JSON.stringify(line)).not.toContain('ayse@example.com');
  });

  it('answers rather than hanging when a cause chain loops', async () => {
    const captured = captureLogger();
    // A retry wrapper that re-attaches the original error makes a cycle. The
    // walk had no cap, so it allocated until it threw inside the error
    // handler, which is how the HTML page this layer exists to prevent
    // reaches a client.
    const first = new Error('retry exhausted');
    const second = new Error('connection lost');
    first.cause = second;
    second.cause = first;

    const res = await request(appThrowing(first, captured)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});

describe('exposed client errors that body-parser did not raise', () => {
  it('keeps the status of any other exposed client error', async () => {
    const teapot = Object.assign(new Error('I am a teapot'), { status: 418, expose: true });
    const res = await request(appThrowing(teapot)).get('/boom');

    expect(res.status).toBe(418);
    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Request could not be processed' },
    });
  });

  it('never relabels a server fault as the caller mistake', async () => {
    const pretender = Object.assign(new Error('upstream died'), { status: 503, expose: true });
    const res = await request(appThrowing(pretender)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it.each([
    ['below 400', 42],
    ['at the 5xx boundary', 500],
    ['not an integer', 404.5],
  ])('ignores an exposed status %s rather than letting Express throw', async (_name, status) => {
    const err = Object.assign(new Error('x'), { expose: true, status });
    const res = await request(appThrowing(err)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it('ignores an exposed error with no status', async () => {
    const res = await request(appThrowing(Object.assign(new Error('x'), { expose: true }))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
  });
});

describe('mounted without the http logger', () => {
  it('still answers, instead of throwing inside the error handler', async () => {
    const app = express();
    app.get('/boom', (_req, _res, next) => {
      next(new HttpError('CONFLICT', 'Overlap'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'Overlap' } });
  });
});
