/** One product's hash. The writer that fills the read model builds the same
 *  key; a hand-built string on either side is how the two halves drift. */
export const productKey = (id: number): string => `product:${id}`;
