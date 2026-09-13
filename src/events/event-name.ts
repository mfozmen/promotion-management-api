import type { eventRegistry } from './event-registry.js';

export type EventName = keyof typeof eventRegistry;
