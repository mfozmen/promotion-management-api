import type { Enqueue } from './enqueue.js';
import type { EventBus } from './event-bus.js';

/**
 * The one implementation of `Enqueue`. A function rather than a class because
 * `Enqueue` is a function type: a class here would have one method, no state of
 * its own and no interface to implement, which 8c.9 calls a finding.
 */
export function queueEnqueue(bus: EventBus): Enqueue {
  return (name, payload) => bus.publish(name, payload).then(() => undefined);
}
