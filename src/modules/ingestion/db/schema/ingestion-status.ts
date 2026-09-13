import { pgEnum } from 'drizzle-orm/pg-core';

export const ingestionStatus = pgEnum('ingestion_status', [
  'running',
  'paused',
  'completed',
  'failed',
  'aborted',
]);
