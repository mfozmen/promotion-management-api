import type { RebuildReadModelCommand } from '../commands/rebuild-read-model-command.js';
import type { ReadModelRebuild } from './readmodel-rebuild.js';

/** A rebuild someone asked for: a whole catalogue, or one category when the
 *  reconciler found drift in it. */
export class ReadModelRebuildHandler {
  constructor(private readonly rebuild: RebuildReadModelCommand) {}

  async handle({ category }: ReadModelRebuild): Promise<void> {
    if (category === undefined) {
      await this.rebuild.rebuildAll();
      return;
    }

    await this.rebuild.rebuildCategory(category);
  }
}
