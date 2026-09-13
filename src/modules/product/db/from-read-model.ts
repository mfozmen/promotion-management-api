import { readModelUnavailable } from './read-model-unavailable.js';

/** Wraps the Redis reply, never the parse that follows it: a store we cannot
 *  reach is a 503, a row the writer got wrong is a 500. The readiness gate
 *  maps its own command, and every command after it opens the same window. */
export async function fromReadModel<T>(reply: Promise<T>): Promise<T> {
  try {
    return await reply;
  } catch (error) {
    throw readModelUnavailable(error);
  }
}
