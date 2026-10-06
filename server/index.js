import { createApp } from './app.js';
import { environment } from './config.js';
const parsed = Number(environment().PORT || 3000);
const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 3000;
const server = createApp().listen(port, '127.0.0.1', () =>
  console.log(`Azure SQL Workbench is running at http://127.0.0.1:${port}`),
);
server.on('error', () => {
  console.error(
    'The local server could not start. Check whether the configured port is already in use.',
  );
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
