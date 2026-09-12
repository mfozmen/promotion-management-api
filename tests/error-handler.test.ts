import { describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { httpLogger } from '../src/shared/logger.js';
import { AppError } from '../src/shared/http-error.js';
import { DrizzleQueryError } from 'drizzle-orm';
import { captureLogger, type CapturedLogger } from './helpers/capture-logger.js';

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

// The real class, not a hand-built lookalike: drizzle puts the statement and
// the bound row in `message` and the SQLSTATE on `cause`, and a fixture that
// guesses that shape certifies the leak it was written to catch.
const overlap = () => {
  const pgError = Object.assign(
    new Error('conflicting key value violates exclusion constraint "promotions_no_overlap"'),
    {
      name: 'PostgresError',
      code: '23P01',
      detail: 'Key (product_id)=(3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80) conflicts.',
      where: 'PL/pgSQL function',
    },
  );

  return new DrizzleQueryError(
    'insert into "promotions" ("product_id", "discount_bp", "customer_email") values ($1, $2, $3)',
    ['3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80', 2000, 'ayse@example.com'],
    pgError,
  );
};

describe('AppError mapping', () => {
  it.each([
    [400, 'VALIDATION_ERROR', 'Invalid request body'],
    [404, 'NOT_FOUND', 'Product not found'],
    [409, 'CONFLICT', 'An active promotion already covers this product'],
    [429, 'BACKPRESSURE', 'Too many pending imports'],
    [503, 'READ_MODEL_NOT_READY', 'The read model is still being built'],
  ])('answers %i with its code', async (status, code, message) => {
    const res = await request(appThrowing(new AppError(status, code, message))).get('/boom');

    expect(res.status).toBe(status);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { code, message } });
  });

  it('includes details when the error carries them', async () => {
    const details = [{ path: 'page', message: 'Too small' }];
    const res = await request(
      appThrowing(new AppError(400, 'VALIDATION_ERROR', 'Invalid request query', details)),
    ).get('/boom');

    expect(res.body.error.details).toEqual(details);
  });

  it('logs the rejection with the correlation id', async () => {
    const captured = captureLogger();
    await request(appThrowing(new AppError(409, 'CONFLICT', 'Overlap'), captured))
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
      next(overlap());
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
  it('keeps the statement and the bound row out of the log', async () => {
    const captured = captureLogger();
    await request(appThrowing(overlap(), captured)).get('/boom');

    const serialised = JSON.stringify(captured.lines.find((line) => line.level === 50));
    expect(serialised).not.toContain('discount_bp');
    expect(serialised).not.toContain('3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80');
    expect(serialised).not.toContain('customer_email');
    expect(serialised).not.toContain('ayse@example.com');
    expect(serialised).not.toContain('Failed query');
    expect(serialised).not.toContain('PL/pgSQL');
  });

  it('keeps the SQLSTATE and the constraint name, which is what diagnoses it', async () => {
    const captured = captureLogger();
    await request(appThrowing(overlap(), captured)).get('/boom');

    expect(captured.lines.find((line) => line.level === 50)).toMatchObject({
      error: {
        type: 'PostgresError',
        code: '23P01',
        message: expect.stringContaining('promotions_no_overlap'),
        stack: expect.stringContaining('at '),
      },
    });
  });

  it('does not let a bound value pose as a stack frame', async () => {
    const captured = captureLogger();
    const err = new DrizzleQueryError(
      'insert into "products" ("name") values ($1)',
      ['Kazak\n    at secret-bound-value'],
      undefined,
    );

    await request(appThrowing(err, captured)).get('/boom');

    expect(JSON.stringify(captured.lines.find((line) => line.level === 50))).not.toContain(
      'secret-bound-value',
    );
  });

  it('drops a driver message from the first quoted value on', async () => {
    const captured = captureLogger();
    const err = new DrizzleQueryError(
      'select * from "products" where "id" = $1',
      ['not-a-uuid'],
      Object.assign(
        new Error('invalid input syntax for type uuid: "not-a-uuid-but-a-customer-secret"'),
        { code: '22P02' },
      ),
    );

    await request(appThrowing(err, captured)).get('/boom');

    expect(captured.lines.find((line) => line.level === 50)).toMatchObject({
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    });
  });

  it('omits the code when the error carries none', async () => {
    const captured = captureLogger();
    await request(appThrowing(new Error('plain'), captured)).get('/boom');

    expect(captured.lines.find((line) => line.level === 50)?.error).not.toHaveProperty('code');
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
      next(new AppError(409, 'CONFLICT', 'Overlap'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'Overlap' } });
  });
});

describe('AppError', () => {
  it('keeps its status, code and message', () => {
    const error = new AppError(409, 'CONFLICT', 'Overlap');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Overlap');
    expect(error.details).toBeUndefined();
  });
});
