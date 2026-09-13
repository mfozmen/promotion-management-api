import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { buildSchemaDdl } from '../src/shared/db/build-schema-ddl.js';
import { MIGRATIONS_FOLDER } from '../src/shared/db/migrate.js';

// Resolved from this file, so a run from the wrong directory fails on the read below rather
// than writing an export into another tree.
const target = new URL('../docs/schema.sql', import.meta.url);

await writeFile(target, await buildSchemaDdl(MIGRATIONS_FOLDER));
console.log('Wrote', fileURLToPath(target), 'from', MIGRATIONS_FOLDER);
