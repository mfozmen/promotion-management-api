import { randomInt } from 'node:crypto';
import createError from 'http-errors';

const MIN_SECONDS = 5;
const SPREAD = 6;

/** Unreachable and unbuilt are one answer to a client: come back, with a
 *  number drawn from a band (ADR-0006). */
export class ReadModelUnavailable extends createError.ServiceUnavailable {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.expose = true;
    this.headers = { 'retry-after': String(randomInt(MIN_SECONDS, MIN_SECONDS + SPREAD)) };
    this.cause = cause;
  }
}
