import { diagnose, withDatabase } from '../server/database.js';
import { catalog, objectInfo, tableData } from '../server/catalog.js';
import { safeError } from '../server/errors.js';
const connection = await diagnose();
for (const check of connection.checks)
  console.log(`${check.status.toUpperCase()} | ${check.name}: ${check.detail}`);
if (!connection.connected) {
  process.exitCode = 1;
} else {
  try {
    await withDatabase(async (pool) => {
      const overview = await catalog(pool);
      console.log(
        `PASS | Metadata: ${overview.objects.length} visible tables/views, ${overview.schemas.length} schemas.`,
      );
      const first = overview.objects[0];
      if (!first) {
        console.log('SKIP | Table read: no visible tables or views.');
        return;
      }
      const info = await objectInfo(pool, first.schemaName, first.name);
      console.log(
        `PASS | Object detail: ${info.columns.length} columns, ${info.foreignKeys.length} foreign-key columns, ${info.indexes.length} index columns.`,
      );
      const data = await tableData(pool, {
        schema: first.schemaName,
        name: first.name,
        page: 0,
        pageSize: 1,
        filters: [],
        direction: 'ASC',
      });
      console.log(
        `PASS | Paginated read: ${data.rows.length} rows returned. No row values are logged.`,
      );
    });
  } catch (error) {
    console.log(`FAILED | ${safeError(error).message}`);
    process.exitCode = 1;
  }
}
console.log('Read-only verification finished. No database data or schema changes were made.');
