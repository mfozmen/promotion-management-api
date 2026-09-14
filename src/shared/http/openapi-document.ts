import type { Express } from 'express';
import { z, type ZodObject } from 'zod';
import { isDocumented } from './documented-scope.js';
import { routeInventory, type InventoriedRoute } from './route-inventory.js';

interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: Record<string, unknown>;
}

interface Operation {
  summary: string;
  parameters?: Parameter[];
  requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<string, unknown>;
}

export interface OpenapiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Partial<Record<string, Operation>> | undefined>;
  components?: { schemas?: Record<string, unknown> };
}

const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
  required: ['error'],
};

const DESCRIPTION = `Generated from the zod schemas that validate each request, so what is written
here is what the API enforces rather than what someone remembered to write down.

What each endpoint accepts, plus the one error envelope they all share. What an endpoint returns on
success is in the README's API table and nowhere else: one response shape is a zod
transform and the rest are TypeScript interfaces, and neither can be converted, so publishing them
here would mean writing them by hand — the one part of this document that could then drift while
looking exactly like the parts that cannot.

Every error, whatever its status, is the envelope below (ADR-0009).`;

/**
 * The document, built by walking the application rather than from a list.
 * A route added later appears here without anyone remembering to add it; one
 * added without schemas appears with no inputs, which the parity test catches.
 */
export function openapiDocument(app: Express): OpenapiDocument {
  const paths: OpenapiDocument['paths'] = {};

  for (const route of routeInventory(app).filter((route) => isDocumented(route.path))) {
    const path = openapiPath(route.path);
    paths[path] = { ...paths[path], [route.method]: operation(route) };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Promotion Management API', version: '1.0.0', description: DESCRIPTION },
    paths,
    components: { schemas: { Error: ERROR_SCHEMA } },
  };
}

function operation(route: InventoriedRoute): Operation {
  const parameters = [
    ...parametersFrom(route.schemas.params, 'path'),
    ...parametersFrom(route.schemas.query, 'query'),
  ];
  const body = route.schemas.body;

  return {
    summary: `${route.method.toUpperCase()} ${route.path}`,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: jsonSchema(body) } },
          },
        }
      : {}),
    responses: {
      default: {
        description: 'An error. Every status answers this envelope (ADR-0009).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  };
}

/** One parameter per field: a path or query schema is an object, OpenAPI is not. */
function parametersFrom(schema: ZodObject | undefined, where: 'path' | 'query'): Parameter[] {
  if (schema === undefined) return [];
  const object = jsonSchema(schema);
  const properties = object.properties as Record<string, Record<string, unknown>>;
  const required = new Set((object.required ?? []) as string[]);

  return Object.entries(properties).map(([name, field]) => ({
    name,
    in: where,
    // A path parameter is required by the specification whatever the schema says.
    required: where === 'path' || required.has(name),
    schema: field,
  }));
}

/** `io: 'input'` because a document describes what a caller sends: a schema that
 *  parses `"7"` into `7` must publish the string, which is what goes in the URL. */
function jsonSchema(schema: ZodObject): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  void $schema;

  return rest;
}

function openapiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}
