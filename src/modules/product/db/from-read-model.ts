import { readModelUnavailable } from './read-model-unavailable.js';

/** Wraps the reply, never the parse that follows it (`read-model-unavailable.ts`
 *  says why). Every command after the readiness gate opens the same window. */
export async function fromReadModel<T>(reply: Promise<T>): Promise<T> {
  try {
    return await reply;
  } catch (error) {
    throw readModelUnavailable(error);
  }
}
