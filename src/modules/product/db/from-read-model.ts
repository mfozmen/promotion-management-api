import { replyFailure } from './reply-failure.js';

/** Wraps the reply, never the parse that follows it (`read-model-unavailable.ts`
 *  says why). Every command after the readiness gate opens the same window, and
 *  a direct command rejects with the same two shapes a pipeline resolves with,
 *  so both go through one classifier: a server-side error is the writer's bug
 *  wherever it arrives, not an outage to retry. */
export async function fromReadModel<T>(reply: Promise<T>): Promise<T> {
  try {
    return await reply;
  } catch (error) {
    throw replyFailure(error as Error);
  }
}
