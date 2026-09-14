import { describe, expect, it, vi } from 'vitest';
import { ReadModelRebuildHandler } from '@src/modules/storefront/events/readmodel-rebuild-handler.js';
import type { RebuildReadModelCommand } from '@src/modules/storefront/commands/rebuild-read-model-command.js';

const command = () =>
  ({
    rebuildAll: vi.fn().mockResolvedValue(undefined),
    rebuildCategory: vi.fn().mockResolvedValue(0),
  }) as unknown as RebuildReadModelCommand;

describe('ReadModelRebuildHandler', () => {
  it('rebuilds the whole catalogue when the job names no scope', async () => {
    const rebuild = command();

    await new ReadModelRebuildHandler(rebuild).handle({});

    expect(rebuild.rebuildAll).toHaveBeenCalledOnce();
    expect(rebuild.rebuildCategory).not.toHaveBeenCalled();
  });

  it('rebuilds only the category the job names', async () => {
    const rebuild = command();

    await new ReadModelRebuildHandler(rebuild).handle({ category: 'knitwear' });

    expect(rebuild.rebuildCategory).toHaveBeenCalledWith('knitwear');
    expect(rebuild.rebuildAll).not.toHaveBeenCalled();
  });
});
