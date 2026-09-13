import { pino } from 'pino';
import { serializeError } from './serialize-error.js';

// pino's default `err` serializer copies an error's own enumerable properties, which for a
// `DrizzleQueryError` means the statement and the caller's bound values (ADR-0010).
export const logger = pino({ serializers: { err: serializeError } });
