import { randomInt } from 'node:crypto';

const MIN_SECONDS = 5;
const SPREAD = 6;

/** A band rather than a fixed number, so a fleet that met one outage does not
 *  come back in the same second. `crypto.randomInt` because a non-cryptographic
 *  generator on a response header is a security hotspot. */
export const RETRY_AFTER = (): string => String(randomInt(MIN_SECONDS, MIN_SECONDS + SPREAD));
