import type { Promotion } from './promotion.js';

/** What `isActive` narrows to. */
export type ActivePromotion = Promotion & { status: 'active' };
