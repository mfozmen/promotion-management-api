import { describe, expect, it, vi } from 'vitest';
import { MaintenanceDispatcher } from '@src/events/maintenance-dispatcher.js';

const collaborators = () => ({
  reconciler: { handle: vi.fn().mockResolvedValue(undefined) },
  rebuild: { handle: vi.fn().mockResolvedValue(undefined) },
});

describe('MaintenanceDispatcher', () => {
  it('sends a sweep to the reconciler', async () => {
    const c = collaborators();

    await new MaintenanceDispatcher(c.reconciler, c.rebuild).handle('reconciler.run', {});

    expect(c.reconciler.handle).toHaveBeenCalledOnce();
    expect(c.rebuild.handle).not.toHaveBeenCalled();
  });

  it('sends a rebuild its scope, which is what makes a scoped rebuild scoped', async () => {
    const c = collaborators();

    await new MaintenanceDispatcher(c.reconciler, c.rebuild).handle('readmodel.rebuild', {
      category: 'knitwear',
    });

    expect(c.rebuild.handle).toHaveBeenCalledWith({ category: 'knitwear' });
  });

  it('refuses a job it has no handler for rather than acknowledging it', async () => {
    const c = collaborators();

    await expect(
      new MaintenanceDispatcher(c.reconciler, c.rebuild).handle('chunk.process', {}),
    ).rejects.toThrow('no handler for chunk.process');
  });

  it('lets a failing handler reach BullMQ, so the job is recorded as failed', async () => {
    const c = collaborators();
    c.rebuild.handle.mockRejectedValue(new Error('redis down'));

    await expect(
      new MaintenanceDispatcher(c.reconciler, c.rebuild).handle('readmodel.rebuild', {}),
    ).rejects.toThrow('redis down');
  });
});
