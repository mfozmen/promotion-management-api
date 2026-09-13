import { writeFile } from 'node:fs/promises';
import { buildSchemaDdl } from '../src/shared/db/build-schema-ddl.js';
import { MIGRATIONS_FOLDER } from '../src/shared/db/migrate.js';

// Resolved from this file, not from the working directory: run from elsewhere and the read
// below fails loudly rather than writing an export into whatever tree happens to be current.
const target = new URL('../docs/schema.sql', import.meta.url);

await writeFile(target, await buildSchemaDdl(MIGRATIONS_FOLDER));
console.log('Wrote docs/schema.sql from', MIGRATIONS_FOLDER);
