import type { ZodObject } from 'zod';

/** The request parts a route declares. A part with no schema reaches the
 *  handler raw, so declaring one is how a route opts into validation. */
export interface RequestSchemas {
  body?: ZodObject;
  query?: ZodObject;
  params?: ZodObject;
}
