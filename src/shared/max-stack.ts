/** How much of a stack reaches the log. A stack opens with the whole message and
 *  a driver composes that message out of the failing statement and its bound row,
 *  so an uncapped stack is the one field that carries what the caps exist to stop. */
export const MAX_STACK = 2_000;
