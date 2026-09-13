import { pgEnum } from 'drizzle-orm/pg-core';

export const pricingRuleType = pgEnum('pricing_rule_type', ['ingestion', 'promotion']);
