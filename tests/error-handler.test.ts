import { describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { httpLogger } from '../src/shared/logger.js';
import { AppError } from '../src/shared/http-error.js';
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
    expect(logged).toMatchObject({ err: { message: 'boom', stack: expect.any(String) } });
  });

  it('masks a thrown non-error value', async () => {
    const res = await request(appThrowing('something went wrong')).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it('masks an error carrying an unmapped type', async () => {
    const res = await request(
      appThrowing(Object.assign(new Error('nope'), { type: 'unknown' })),
    ).get('/boom');

    expect(res.status).toBe(500);
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
