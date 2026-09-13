import { writeFile } from 'node:fs/promises';
import { buildSchemaDdl } from '../src/shared/db/build-schema-ddl.js';
import { MIGRATIONS_FOLDER } from '../src/shared/db/migrate.js';

await writeFile('docs/schema.sql', await buildSchemaDdl(MIGRATIONS_FOLDER));
console.log('Wrote docs/schema.sql from', MIGRATIONS_FOLDER);
