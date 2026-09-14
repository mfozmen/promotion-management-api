/** One queue per urgency class; two events that need different priority need different workers. */
export type QueueName = 'promotions' | 'products' | 'ingestion' | 'maintenance';
