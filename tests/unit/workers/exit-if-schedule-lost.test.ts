import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '@src/shared/logger.js';
import { exitIfScheduleLost } from '@src/workers/exit-if-schedule-lost.js';

const SCHEDULE_LOST = 'Failed to add repeatable job for next iteration:';

describe('exitIfScheduleLost', () => {
  it('exits on the failure that stops the schedule, so the boot re-asserts it', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    exitIfScheduleLost('reconciler', new Error(`${SCHEDULE_LOST} Connection is closed`));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('logs and keeps running for a worker error a restart would not repair', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    exitIfScheduleLost('reconciler', new Error('job failed'));

    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('matches prose BullMQ still builds, rather than a string copied once', async () => {
    // The trigger is a template literal in the library, not anything its API promises: a bump
    // that reworded it would leave the listener logging while the schedule stays dead, with
    // every other test green. This is what fails on that bump.
    const resolve = createRequire(import.meta.url);
    const source = await readFile(resolve.resolve('bullmq/dist/cjs/classes/worker.js'), 'utf8');

    expect(source).toContain(SCHEDULE_LOST);
  });
});
