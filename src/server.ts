import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { runMigrations } from './shared/db/migrate.js';
import { logger } from './shared/logger.js';
import { createReadModelClient } from './shared/read-model-client.js';

const config = loadConfig();

// Before the first request rather than beside it: the health check is what `up --wait`
// waits on, so it must not answer in front of a schema that is not there yet.
await runMigrations(config.DATABASE_URL);

const redis = createReadModelClient(config.REDIS_URL, config.REDIS_READ_MODEL_DB);

createApp({ redis }).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});
