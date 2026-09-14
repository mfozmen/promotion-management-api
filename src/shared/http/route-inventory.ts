import type { Express } from 'express';
import type { ZodObject } from 'zod';

const MOUNTED_AT = Symbol.for('pma.mountedAt');
const VALIDATES = Symbol.for('pma.validates');
const BODY_READ_BY = Symbol.for('pma.bodyReadBy');

export interface InventoriedRoute {
  method: string;
  path: string;
  schemas: { body?: ZodObject; query?: ZodObject; params?: ZodObject };
  bodyReadBy?: string;
}

interface Layer {
  name: string;
  handle?: { stack?: Layer[] } & Record<symbol, unknown>;
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

export function routeInventory(app: Express): InventoriedRoute[] {
  return walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '');
}

function walk(stack: Layer[], prefix: string): InventoriedRoute[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = asPath(`${prefix}${layer.route.path}`);

      const handlers = layer.route.stack;
      const reader = handlers
        .map((handler) => handler.handle?.[BODY_READ_BY] as string | undefined)
        .find((takes) => takes !== undefined);

      return Object.keys(layer.route.methods).map((method) => ({
        method,
        path,
        schemas: declared(handlers),
        ...(reader === undefined ? {} : { bodyReadBy: reader }),
      }));
    }
    const nested = layer.handle?.stack;
    if (nested === undefined) return [];

    return walk(nested, `${prefix}${(layer.handle?.[MOUNTED_AT] as string | undefined) ?? ''}`);
  });
}

/** A route may validate its parts in several calls; its inputs are their union. */
function declared(handlers: Layer[]): InventoriedRoute['schemas'] {
  return handlers.reduce<InventoriedRoute['schemas']>(
    (all, handler) => ({
      ...all,
      ...((handler.handle?.[VALIDATES] as InventoriedRoute['schemas'] | undefined) ?? {}),
    }),
    {},
  );
}

/** Only a whole route is normalised. Doing it to a prefix turned an unmounted
 *  router's empty prefix into `/`, and every route under it into `//thing`. */
function asPath(path: string): string {
  return path.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1');
}
