import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import { appDeps } from '@tests/app-deps.js';
import { captureLogger } from '../../capture-logger.js';

describe('httpLogger', () => {
  it('logs a request to the api', async () => {
    const { logger, lines } = captureLogger();

    await request(createApp(appDeps({ logger }))).get('/api/health');

    expect(lines.some((line) => line.msg === 'request completed')).toBe(true);
  });

  it('says nothing about the dashboard, which polls and loads its own assets', async () => {
    // 64 lines a minute with nobody looking at it, burying the lines an operator came for.
    const { logger, lines } = captureLogger();

    await request(createApp(appDeps({ logger }))).get('/admin/queues/api/queues');

    expect(lines.filter((line) => line.msg === 'request completed')).toEqual([]);
  });
});
