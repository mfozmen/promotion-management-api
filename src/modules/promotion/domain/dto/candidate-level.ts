/** The two levels a promotion can target, which is the whole vocabulary a rule
 *  may name: there is no `none`, so a rule cannot hold a product out of a sale. */
export type CandidateLevel = 'product' | 'category';
