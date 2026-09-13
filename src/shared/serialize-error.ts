import { MAX_MESSAGE } from './max-message.js';
import { MAX_STACK } from './max-stack.js';

/** The whitelist every log site calls (REVIEW.md 8.4). The stack goes to the
 *  log and never to a response. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    // Never the value itself: an unknown thrown object may be the leak.
    return { type: typeof err };
  }

  const { code } = err as Error & { code?: unknown };

  return {
    type: err.name,
    message: err.message.slice(0, MAX_MESSAGE),
    // A stack begins with the message, so capping `message` alone caps nothing.
    stack: err.stack?.slice(0, MAX_STACK),
    code: typeof code === 'string' ? code : undefined,
  };
}
