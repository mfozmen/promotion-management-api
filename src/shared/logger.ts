import { pino } from 'pino';
import { serializeError } from './serialize-error.js';

export const logger = pino({ serializers: { err: serializeError } });
