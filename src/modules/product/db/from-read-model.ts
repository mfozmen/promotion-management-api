import { replyFailure } from './reply-failure.js';

/** Wraps the reply, never the parse that follows it (`read-model-unavailable.ts`
 *  says why). Every command after the readiness gate opens the same window, and
 *  a direct command rejects with the same shapes a pipeline resolves with, so
 *  both go through one classifier. */
export async function fromReadModel<T>(reply: Promise<T>): Promise<T> {
  try {
    return await reply;
  } catch (error) {
    throw replyFailure(error);
  }
}
