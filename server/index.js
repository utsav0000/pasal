import { createApp } from './app.js';
import { config } from './config.js';

const server = createApp();
server.listen(config.port, () => {
  console.log(`PASAL running at ${config.publicUrl}  (env: ${config.env}${config.devTools ? ', dev tools on' : ''})`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
