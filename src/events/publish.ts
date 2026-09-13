import type { EventName } from './event-name.js';
import type { EventPayload } from './event-payload.js';

/**
 * How a handler announces an event, narrowed to the one call it makes.
 *
 * A route takes this rather than the `EventQueue` so a test can pin the event
 * without a broker, and so a handler cannot reach past the catalogue into the
 * queue itself. `EventQueue.publish` satisfies it.
 */
export type Publish = <N extends EventName>(name: N, payload: EventPayload<N>) => Promise<void>;
