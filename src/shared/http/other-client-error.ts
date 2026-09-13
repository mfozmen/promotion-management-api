/** The answer for a foreign client error whose status has no row of its own,
 *  so a parser that grows a new status is still answered in our words. */
export const OTHER_CLIENT_ERROR = Object.freeze({
  code: 'BAD_REQUEST',
  message: 'Request could not be processed',
} as const);
