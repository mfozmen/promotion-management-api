import type { Enqueue } from './enqueue.js';
import { enqueue, type Queues } from './queue.js';

/** The one implementation of `Enqueue`, bound to the process's queues. */
export function queueEnqueue(queues: Queues): Enqueue {
  return (name, payload) => enqueue(queues, name, payload).then(() => undefined);
}
