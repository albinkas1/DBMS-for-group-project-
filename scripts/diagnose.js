import { diagnose } from '../server/database.js';
const result = await diagnose();
for (const check of result.checks)
  console.log(`${check.status.toUpperCase()} | ${check.name}: ${check.detail}`);
console.log(`Completed in ${result.elapsedMs} ms. No database changes were made.`);
process.exitCode = result.connected ? 0 : 1;
