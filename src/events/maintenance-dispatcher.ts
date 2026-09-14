import type { ReadModelRebuild } from '../modules/storefront/events/readmodel-rebuild.js';

interface ReconcilerRun {
  handle(): Promise<void>;
}

interface ReadModelRebuildRun {
  handle(payload: ReadModelRebuild): Promise<void>;
}

/** The `maintenance` queue carries two events and one Worker drains it, so
 *  something has to choose. It is here rather than in the entry point because an
 *  entry point is excluded from coverage and imported by no test: a dispatch
 *  decision made there can be inverted with the whole suite still green. */
export class MaintenanceDispatcher {
  constructor(
    private readonly reconciler: ReconcilerRun,
    private readonly rebuild: ReadModelRebuildRun,
  ) {}

  async handle(name: string, payload: unknown): Promise<void> {
    if (name === 'reconciler.run') return this.reconciler.handle();
    if (name === 'readmodel.rebuild') return this.rebuild.handle(payload as ReadModelRebuild);

    // A job whose name nothing handles is acknowledged as done if it is ignored,
    // so it is thrown instead and BullMQ keeps it.
    throw new Error(`no handler for ${name}`);
  }
}
