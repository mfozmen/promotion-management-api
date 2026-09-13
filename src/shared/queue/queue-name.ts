/** One queue per urgency class; two events that need different priority need different workers. */
export type QueueName = 'promotions' | 'catalog' | 'ingestion' | 'maintenance';
