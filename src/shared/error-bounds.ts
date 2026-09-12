/**
 * How much of an error may cross a boundary. Both bounds are here because each
 * has two sites that must agree — the validator builds details and the
 * envelope returns them, the envelope returns a message and the logger records
 * one — and a comment saying "matches the other" is a coupling nobody
 * maintains. What belongs here is a bound with more than one enforcement
 * point; a limit with a single site belongs beside it.
 */
export const MAX_DETAILS = 20;
export const MAX_MESSAGE = 200;
