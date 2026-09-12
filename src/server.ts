import { createApp } from './app.js';
import { logger } from './shared/http/logger.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();

app.listen(port, () => {
  logger.info({ port }, 'listening');
});
