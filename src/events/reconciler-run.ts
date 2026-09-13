import { z } from 'zod';

export const reconcilerRun = z.strictObject({});

export type ReconcilerRun = z.infer<typeof reconcilerRun>;
