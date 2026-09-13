import type { z } from 'zod';
import type { EventName } from './event-name.js';
import type { eventRegistry } from './event-registry.js';

export type EventPayload<N extends EventName> = z.infer<(typeof eventRegistry)[N]>;
