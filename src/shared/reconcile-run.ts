import { z } from 'zod';

export const reconcileRun = z.strictObject({});

export type ReconcileRun = z.infer<typeof reconcileRun>;
