import { pino } from 'pino';

/** The one root logger: one process, one stream. */
export const logger = pino();
