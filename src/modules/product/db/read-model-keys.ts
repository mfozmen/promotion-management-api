/**
 * The read model's key layout (design §5), in one place because the writer of
 * issue #12 and these read routes have to agree on it exactly. A key built by
 * hand on one side is how the two halves drift apart.
 */
export const READY_KEY = 'readmodel:ready';
export const ALL_PRODUCTS = 'products:all';
export const productKey = (id: number | string): string => `product:${id}`;
export const categoryKey = (category: string): string => `category:${category}`;
