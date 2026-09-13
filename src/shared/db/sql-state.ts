/** The PostgreSQL error codes this application reacts to. */
export const SqlState = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
} as const;
