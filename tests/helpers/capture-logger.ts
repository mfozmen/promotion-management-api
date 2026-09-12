import { pino, type Logger } from 'pino';

export interface CapturedLogger {
  logger: Logger;
  lines: Record<string, unknown>[];
}

/** A pino logger that keeps every emitted line in memory, so tests can assert on them. */
export function captureLogger(): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'trace' },
    {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );

  return { logger, lines };
}
