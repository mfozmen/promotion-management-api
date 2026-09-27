import { pino, type Logger } from 'pino';
import { serializeError } from '@src/shared/serialize-error.js';

export interface CapturedLogger {
  logger: Logger;
  lines: Record<string, unknown>[];
}

/** A pino logger that keeps every emitted line in memory, so tests can assert on them. */
export function captureLogger(level = 'trace'): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  // The same serializer the root logger runs, so a test sees the line production would write
  // rather than pino's default (REVIEW.md 7.4b).
  const logger = pino(
    { level, serializers: { err: serializeError } },
    {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );

  return { logger, lines };
}
