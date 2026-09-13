import type { z } from 'zod';
import type { EventName } from './event-name.js';
import type { registry } from './registry.js';

export type EventPayload<N extends EventName> = z.infer<(typeof registry)[N]>;
