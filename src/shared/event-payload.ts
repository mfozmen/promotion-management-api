import type { z } from 'zod';
import type { EventName } from './event-name.js';
import type { eventSchemas } from './event-schemas.js';

export type EventPayload<N extends EventName> = z.infer<(typeof eventSchemas)[N]>;
