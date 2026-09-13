import { describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '@src/shared/http/error-handler.js';
import { httpLogger } from '@src/shared/http/http-logger.js';
import createError from 'http-errors';

/** The raiser owns the hint now, so the test writes one rather than importing it. */
const retryAfter = (): string => '5';
import { captureLogger, type CapturedLogger } from '../../capture-logger.js';

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

describe('errorHandler', () => {
  it.each([
    [400, 'Invalid request body'],
    [404, 'Product not found'],
    [409, 'An active promotion already covers this product'],
    [429, 'Too many pending imports'],
  ])('answers %i with the message its raiser wrote', async (status, message) => {
    // A 4xx is exposed by default, so the raiser's words reach the caller and the
    // status carries which failure it was. There is no code field to disagree with it.
    const res = await request(appThrowing(createError(status, message))).get('/boom');

    expect(res.status).toBe(status);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { message } });
  });

  it('never returns the message of a 5xx a handler raised', async () => {
    // Written for an operator, and this one carries a credential and a host.
    const leaky = createError(500, 'password hunter2 rejected by 10.0.0.5');
    const res = await request(appThrowing(leaky)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    expect(res.text).not.toContain('hunter2');
    expect(res.text).not.toContain('10.0.0.5');
  });

  it('answers a designed 5xx with the public wording its raiser vouched for', async () => {
    // `expose: true` is the raiser saying these words are for a client, so the
    // words have to be written for one. Operator prose does not get the flag.
    const res = await request(
      appThrowing(
        createError(503, 'The read model is not ready yet; retry shortly', {
          headers: { 'retry-after': retryAfter() },
          expose: true,
        }),
      ),
    ).get('/boom');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        // Not "Internal server error": a 503 tells a human to retry.
        message: 'The read model is not ready yet; retry shortly',
      },
    });
    expect(res.text).not.toContain('10.0.0.5');
  });

  it('gives a 5xx code with no public wording nothing to say', async () => {
    const res = await request(appThrowing(createError(500, 'upstream 10.0.0.5 refused'))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    expect(res.text).not.toContain('10.0.0.5');
  });

  it('logs a handler-raised 5xx as a server fault, with its message', async () => {
    const captured = captureLogger();
    await request(appThrowing(createError(500, 'the wheels came off'), captured)).get('/boom');

    expect(captured.lines.find((line) => line.level === 50)).toMatchObject({
      err: { message: 'the wheels came off' },
    });
  });

  it('masks a 5xx by default and exposes a 4xx, without anyone deciding', () => {
    // The library's own rule, and the reason we keep none of our own: a message
    // written for an operator is withheld because nobody remembered to withhold it.
    expect(createError(500, 'x').expose).toBe(false);
    expect(createError(409, 'x').expose).toBe(true);
    expect(createError(503, 'x', { expose: true }).expose).toBe(true);
  });

  it('logs the rejection with the correlation id', async () => {
    const captured = captureLogger();
    await request(appThrowing(createError(409, 'Overlap'), captured))
      .get('/boom')
      .set('x-request-id', 'trace-1');

    const rejected = captured.lines.find((line) => line.level === 40);
    // The reason too: a 400 tells the caller which part failed, and the operator
    // reading the log would otherwise know less than the client did.
    expect(rejected).toMatchObject({ status: 409, reason: 'Overlap', reqId: 'trace-1' });
  });
});

describe('errorHandler: unexpected errors', () => {
  it('masks the failure as a 500 without internal detail', async () => {
    const res = await request(appThrowing(new Error('connect ECONNREFUSED 10.0.0.1:5432'))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    expect(res.text).not.toContain('ECONNREFUSED');
    expect(res.text).not.toContain('at ');
  });

  it('logs the stack so the failure can be diagnosed', async () => {
    const captured = captureLogger();
    await request(appThrowing(new Error('boom'), captured)).get('/boom');

    const logged = captured.lines.find((line) => line.level === 50);
    expect(logged).toMatchObject({
      err: { message: 'boom', stack: expect.stringContaining('at ') },
    });
  });

  it('logs a retriable 5xx as a condition, not a fault, and joins it to the response', async () => {
    const captured = captureLogger();
    const raised = createError(503, 'rebuild running', {
      headers: { 'retry-after': retryAfter() },
      expose: true,
    });
    // The real `Error.cause`: pino's serializer reads it and a property would not do.
    raised.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    await request(appThrowing(raised, captured)).get('/boom');

    // At `warn`, not `error`: a retriable 5xx is an operating condition, and a rebuild
    // would otherwise write one alertable line per request. The two top-level fields are
    // what join the line to the response the client read.
    const logged = captured.lines.find((line) => line.level === 40);
    expect(logged).toMatchObject({ status: 503 });
    expect(captured.lines.some((line) => line.level === 50)).toBe(false);
  });

  it("passes the raiser's retry hint through untouched", async () => {
    // The handler no longer invents one. Spreading the hint so an outage's clients
    // do not all return in the same second is the raiser's to do, and nothing raises
    // a retriable error yet — the story that does owns the jitter (ADR-0009).
    const res = await request(
      appThrowing(createError(429, 'queue is full', { headers: { 'retry-after': '7' } })),
    ).get('/boom');

    expect(res.headers['retry-after']).toBe('7');
  });

  it('sends no retry hint on an error retrying cannot fix', async () => {
    const res = await request(appThrowing(createError(404, 'nope'))).get('/boom');

    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('masks a thrown non-error value and still logs its type', async () => {
    const captured = captureLogger();
    const res = await request(appThrowing('something went wrong', captured)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    // pino passes a non-Error through as it found it, so the thrown value itself is
    // on the line. It never reaches the response, which is the boundary that matters.
    expect(captured.lines.find((line) => line.level === 50)).toMatchObject({
      err: 'something went wrong',
    });
  });

  it('masks an error carrying an unmapped type', async () => {
    const res = await request(
      appThrowing(Object.assign(new Error('nope'), { type: 'unknown' })),
    ).get('/boom');

    expect(res.status).toBe(500);
  });
});

describe('errorHandler: after the response has started', () => {
  it('does not try to write a second body over the first', async () => {
    const captured = captureLogger();
    const app = express();
    app.use(httpLogger(captured.logger));
    app.get('/stream', (_req, res, next) => {
      res.status(200).type('json').write('{"items":[');
      next(new Error('the stream broke'));
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

describe('errorHandler: exposed client errors body-parser did not raise', () => {
  it('keeps the status of any other exposed client error', async () => {
    // The library's own duck type, which body-parser satisfies: `status` and
    // `statusCode` agreeing, plus a boolean `expose`.
    const teapot = Object.assign(new Error('I am a teapot'), {
      status: 418,
      statusCode: 418,
      expose: true,
    });
    const res = await request(appThrowing(teapot)).get('/boom');

    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: { message: 'I am a teapot' } });
  });

  it('answers 500 to an error that only half looks like one', async () => {
    // `status` without `statusCode` is not the library's shape, and guessing at a
    // half-shaped error is how a thrown object's own message reaches a client.
    const halfShaped = Object.assign(new Error('leaky 10.0.0.5'), { status: 418, expose: true });
    const res = await request(appThrowing(halfShaped)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
  });

  it.each([
    ['a 5xx', 503],
    ['a status below 400', 42],
    ['a fractional status', 404.5],
  ])('answers 500 to an error carrying %s and no statusCode', async (_name, status) => {
    // `status` without `statusCode` fails the library's duck type, so none of these
    // reaches `res.status`. The handler performs no range check of its own and needs
    // none: nothing in this repository produces such an object (REVIEW.md 12.7).
    const err = Object.assign(new Error('x'), { expose: true, status });
    const res = await request(appThrowing(err)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
  });

  it('ignores an exposed error with no status', async () => {
    const res = await request(appThrowing(Object.assign(new Error('x'), { expose: true }))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
  });
});
