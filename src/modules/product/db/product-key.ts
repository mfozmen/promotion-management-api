/** One product's hash. The writer of #12 builds the same key; a hand-built
 *  string on either side is how the two halves drift apart. */
export const productKey = (id: number): string => `product:${id}`;
