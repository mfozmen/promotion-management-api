import type { EventName, EventPayload } from './events.js';

/**
 * How a route emits an event, narrowed to the one call it makes.
 *
 * The routes take this rather than the `Queues` record so that a test pins the
 * event a handler emits without a Redis, and so that a handler cannot reach
 * past the catalogue into the queue itself. `enqueue` in `queue.ts` satisfies it.
 */
export type Enqueue = <N extends EventName>(name: N, payload: EventPayload<N>) => Promise<void>;
