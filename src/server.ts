import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { runMigrations } from './shared/db/migrate.js';

const config = loadConfig();

// Before the first request rather than beside it: the health check is what `up --wait`
// waits on, so it must not answer in front of a schema that is not there yet.
await runMigrations(config.DATABASE_URL);

createApp().listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT}`);
});
