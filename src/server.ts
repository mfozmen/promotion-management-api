import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { logger } from './shared/logger.js';
import { createReadModelClient } from './shared/read-model-client.js';

const config = loadConfig();
const redis = createReadModelClient(config.REDIS_URL, config.REDIS_READ_MODEL_DB);
const app = createApp({ redis });

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});
