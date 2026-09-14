import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * One registry for the process, rather than `prom-client`'s global default: a test that builds a
 * second app would otherwise register the same metric twice and throw, and the global would carry
 * whatever an earlier test left in it.
 */
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });
