import { pgEnum } from 'drizzle-orm/pg-core';

export const chunkStatus = pgEnum('chunk_status', ['pending', 'running', 'done', 'failed']);
