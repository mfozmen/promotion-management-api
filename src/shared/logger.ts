import { pino } from 'pino';

/** The one root logger. Every module takes it as a dependency rather than
 *  importing a second instance, so one process writes one stream. */
export const logger = pino();
