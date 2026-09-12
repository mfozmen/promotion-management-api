import { closeQueues, type Queues } from './queue.js';

/** `server.close` waits for every open connection, so one long request can hold
 *  the process open until the orchestrator escalates to `SIGKILL`. Past this the
 *  queues are closed anyway and the exit is taken. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** `Number('')` is 0 and `Number('abc')` is `NaN`, so an unset-but-present
 *  `SHUTDOWN_TIMEOUT_MS=` in a compose or Kubernetes env block would otherwise
 *  force every shutdown immediately. Digits only; `0` is a deliberate value. */
export function parseShutdownTimeout(raw: string | undefined): number {
  return raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : SHUTDOWN_TIMEOUT_MS;
}

export async function shutdown(
  server: { close: (onClosed: () => void) => void },
  queues: Queues,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<'drained' | 'forced'> {
  let timer: NodeJS.Timeout | undefined;
  const drained = await Promise.race([
    new Promise<boolean>((resolve) => server.close(() => resolve(true))),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  await closeQueues(queues);
  return drained ? 'drained' : 'forced';
}
