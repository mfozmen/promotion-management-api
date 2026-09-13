import { z } from 'zod';

export const detailParams = z.strictObject({ id: z.coerce.number().int().min(1) });

export type DetailParams = z.infer<typeof detailParams>;
