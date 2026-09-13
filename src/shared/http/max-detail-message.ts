/** The longest a single `details[].message` may be. Derived, not picked: the
 *  largest one this boundary produces is the rejected-keys line, which is
 *  bounded at 20 keys of 64 characters plus quoting and a prefix — about 1 380
 *  — so anything below that would cut a caller's own key out of the message
 *  8.3b exists to return. With `MAX_DETAILS` that bounds a response body at
 *  roughly 30 kB, against no bound at all before (ADR-0009). */
export const MAX_DETAIL_MESSAGE = 1_500;
