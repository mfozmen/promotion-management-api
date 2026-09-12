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
    // Never the value itself: an unknown thrown object may be the leak.
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
      next(new Error('the query died halfway'));
    });
    app.use(errorHandler);

    // The half-written body is not patched up with an error envelope: the
    // connection is destroyed, so the client sees a truncated response and
    // cannot mistake it for a complete one.
    await expect(request(app).get('/stream')).rejects.toThrow(/aborted/);

    expect(captured.lines).toContainEqual(
      expect.objectContaining({ msg: 'unhandled error after the response started' }),
    );
  });
});

describe('log hygiene for driver errors', () => {
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

  it('keeps the statement and the bound row out of the log', async () => {
    const captured = captureLogger();
    await request(appThrowing(overlap(), captured)).get('/boom');

    const serialised = JSON.stringify(captured.lines.find((line) => line.level === 50));
    expect(serialised).not.toContain('discount_bp');
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

  it('omits the code when the error carries none', async () => {
    const captured = captureLogger();
    await request(appThrowing(new Error('plain'), captured)).get('/boom');

    expect(captured.lines.find((line) => line.level === 50)?.error).not.toHaveProperty('code');
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
