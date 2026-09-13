import type { eventSchemas } from './event-schemas.js';

export type EventName = keyof typeof eventSchemas;
