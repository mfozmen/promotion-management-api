/** How many validation details cross the boundary. Two sites enforce it: the
 *  validator bounds the work of building them, the envelope bounds what is
 *  returned. One constant, so the two cannot drift. */
export const MAX_DETAILS = 20;
