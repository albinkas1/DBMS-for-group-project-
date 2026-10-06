# Azure SQL Workbench

A local database management interface for Azure SQL, built with React, CodeMirror, Express and the Microsoft SQL Server Node.js driver. Database access uses **one SQL connection string**. There are no separate database server-name, username or password settings.

## Connection diagnosis

The requested project folder was empty. There was no existing application to repair, no `.env` and no configured connection string. The only confirmed blocker was missing configuration; an Azure firewall, authentication or network failure could not be diagnosed without a connection string.

This project adds `.env` loading, connection-string parsing, verified TLS, bounded connection attempts, and a read-only diagnostic path: configuration → DNS → TCP reachability → database login and `SELECT 1, DB_NAME()`. An empty connection string produces a clear configuration error. It does not attempt a database connection or change Azure settings.

**Live Azure connectivity is now verified.** After the SQL connection string became available in `.env`, configuration, DNS, TCP access, encrypted authentication and the read-only SELECT all passed. The app also verified visible metadata, a paginated read, sorting/filtering, multiple SQL result sets and safe SQL error reporting. No database data or schema was changed during implementation or testing.

## Run on Windows

Requires Node.js 22.12 or newer. In PowerShell:

```powershell
cd 'C:\Users\qalbi\OneDrive\Desktop\DBMS-PROJECT'
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:3000>. Keep the terminal running. Press Ctrl+C to stop it.

The delivered project already includes installed dependencies and a built interface, so normally only `npm start` is necessary. Run `npm run build` after changing the interface. `npm run dev` restarts the backend when server source changes; it does not rebuild the interface.

## Set the SQL connection string

Edit `.env` in the project folder. It is already created and configured on this computer. For a fresh checkout, copy .env.example to .env first. Do not paste the real value into a chat, screenshot, browser form, source file or README.

```dotenv
AZURE_SQL_CONNECTION_STRING='your complete Azure SQL connection string'
```

The supported form is Azure's ADO.NET-style SQL connection string, for example **with placeholders only**:

```text
Server=tcp:YOUR-SERVER.database.windows.net,1433;Initial Catalog=YOUR-DATABASE;User ID=YOUR-LOGIN;Password=YOUR-PASSWORD;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

All database connection details are inside this single value. Keep the outer `.env` quotes so a `#` in the password does not start a comment. If the connection-string password contains a semicolon, quote that password inside the connection string using double quotes. The Microsoft SQL driver handles connection-string escaping. The app enforces encryption and certificate validation regardless of weaker values in the string.

Save `.env`, then click **Test connection**. Each connection reloads the file. A process environment variable with the same name takes precedence over `.env`. The frontend build reads no secret from the project root and serves only built public assets. `.env` is ignored by Git and the HTTP server does not serve it.

Optional local tuning, if needed: `PORT` (default 3000), `QUERY_TIMEOUT_MS` (default 30000, permitted 1000–120000), `MAX_RESULT_ROWS` (default 1000, permitted 1–5000). These are not additional database connection settings.

## Features

- **Connection:** configuration, DNS, TCP, and encrypted authentication checks with safe categories and actionable messages. Testing runs read-only SQL.
- **Explorer:** visible schemas, tables and views; columns, types, lengths, nullability, defaults/computed expressions, identity/generated columns, primary keys, outgoing foreign keys with referential actions, and indexes with included columns and filters. Metadata visibility follows the account's permissions.
- **Table data:** 25/50/100/200-row pages, next/previous navigation, sorting with primary-key tie-breakers, and up to 10 parameterized filters combined with AND. No expensive full-table count is required.
- **SQL editor:** T-SQL highlighting, Ctrl+Enter / Run batch, multiple result sets, server row counts, messages, timing, SQL number/line errors, and cancellation. SELECT, INSERT, UPDATE, DELETE and schema changes are sent to SQL Server under the configured account's permissions.
- **Row controls:** insert, update and delete after a typed confirmation. Values are parameterized; object and column identifiers are escaped and checked against metadata. Updates/deletes require a primary key and match original comparable values, plus rowversion if present. A stale or missing row rolls back with an error. Defaults, NULL, identity and computed columns are handled explicitly.
- **History:** last 50 editor executions in process memory, with status and timing. Reopening an entry does not run it. History is cleared on restart and can be cleared in the UI; it is not an audit log.
- **CSV:** export the selected query result set or displayed table page, with standard quoting, UTF-8 BOM, and spreadsheet-formula protection. NULL becomes an empty CSV field. Only displayed results are exported.
- **Team:** Albin, Elisha, Eron, Patrick and Denis, with suggested responsibilities. Edit `client/team.js` to change the roster or responsibilities, then rebuild.

## Safety and limits

This is a **local, single-user application**. It binds only to `127.0.0.1`, rejects foreign Host/Origin headers, uses a request token, and applies browser security headers. The five team members are a project roster, not five login accounts. Do not expose this listener as a shared internet service without adding suitable authentication and deployment controls.

Every SQL batch that is not a conservative read-only SELECT asks for confirmation, including all INSERT/UPDATE/DELETE/schema changes, CTE batches and dynamic execution. This deliberately includes updates/deletes even when a WHERE clause is present. DROP, TRUNCATE and UPDATE/DELETE warnings are explicit. The backend issues a short-lived, single-use token bound to the exact SQL or row operation; changing the request or replaying a token is rejected. The confirmation is a safeguard, not a sandbox or a SQL permissions system. Database permissions remain the authority.

Queries default to a 30-second execution limit and 1,000 displayed rows across result sets, 2 MiB of stored result data, at most 20 result sets and 16,384 displayed characters per cell. SQL `TEXTSIZE` also limits variable-length results to 32 KiB for editor queries and 64 KiB for grid reads before the driver handles them. These limits are for an interactive viewer, not a full backup/export tool. A user-authored batch can explicitly change its own SQL session settings; it still has the app's wall-clock cancellation and display limits.

The app discards excess streamed rows without appending them to memory. It does not inject SET ROWCOUNT or TOP into user SQL because that could change UPDATE/DELETE semantics. A long query is cancelled when its time budget expires. Cancellation or a later SQL error cannot undo statements already committed. Check the database before retrying a write.

Each database operation uses a fresh, bounded connection pool that is closed afterward, so changed session settings and open transactions cannot leak into another editor run. Temporary tables and explicit transactions must therefore be created and used in the **same batch**. An uncommitted transaction is rolled back when its connection closes. `GO` and SQLCMD commands are client directives, not SQL statements; remove them or run batches separately. The app does not rewrite arbitrary SQL or bypass database permissions.

Grid editing is disabled for views, tables without primary keys (updates/deletes), truncated/redacted rows, generated values and unsupported types. Use explicit SQL for those cases. Optimistic checks compare ordinary comparable columns; XML/text/spatial values cannot be compared this way unless a rowversion exists. Concurrent inserts/deletes can shift OFFSET pages, even when primary-key ordering is stable.

Grid reads convert exact numeric keys, decimals and dates to strings before the JavaScript driver can round them. Arbitrary editor result numerics follow driver/JavaScript precision; use `CAST(amount AS varchar(100))` for exact high-precision exports. Large values are intentionally truncated. SQL Server can return SELECT row counts as well as affected DML row counts; the UI labels them **Server row counts**. SET NOCOUNT in your batch or procedures can suppress counts.

Credentials are read only on the backend. Known credential values and connection strings are redacted in API output/errors; raw driver errors and SQL are never logged. Query history is limited and in memory, and the browser does not store query results or credentials in local storage. `.env` remains a local secret file; protect it with your normal file-access and backup practices.

Dependency audit on 6 October 2026: no high or critical production advisories were reported. There is one upstream moderate advisory in `sprintf-js`, reported for three packages along the `mssql → tedious → sprintf-js` dependency chain: [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The advisory concerns attacker-controlled formatting strings with excessive numeric precision. Inspection of the installed driver's call sites found constant formatting strings, and this app does not accept formatting strings, so the described input path was not found here. This is a code-based assessment, not a claim that the dependency is patched. No upstream patched release was listed. The package manager's proposed force-fix downgrades the SQL driver to an old major version; it was not applied. Recheck the advisory when updating dependencies.

## Tests and verification

```powershell
npm test
npm run diagnose
npm run verify:db
```

All 16 automated tests pass and run entirely without a database: SQL confirmation cases, token binding/replay/expiry, hostile origins/hosts, connection parsing and TLS, credential redaction, CSV quoting/formula safety, API history and cancellation, parameterized row changes, key validation, exact numeric projections, pagination/filtering, streaming row/byte/cell limits and timeouts.

The isolated browser fixture is `node tests/ui-fixture.js` at <http://127.0.0.1:3001>. It uses in-memory test rows and **never connects to SQL**. It is not the application launch command. `npm start` always uses the real SQL connector. Browser checks covered results, history, schema tabs, filters, insert/edit/delete confirmations, SQL destructive warnings and the five-member team screen against this fixture.

Live verification on 6 October 2026 passed: encrypted connection and login; 6 visible tables/views and 11 visible schemas; column and index metadata; a one-row paginated read and a second page; primary-key sorting and an equality filter; two SELECT result sets with expected values; and a deliberate read-only divide-by-zero query correctly reported SQL error 8134. The checks did not print row data or credentials. Write execution against your real database was deliberately not tested; insert/update/delete and their confirmations were exercised only with in-memory fixtures and generated-SQL tests. The safe connection command only performs DNS/TCP/login checks and a read-only SELECT. `npm run verify:db` checks visible metadata and reads at most one displayed row from one object, logging counts rather than row values. Test actual writes only in a separately approved disposable database; do not use your production database for destructive testing.

## Troubleshooting

| Check or error | What to inspect |
| --- | --- |
| Configuration | The exact variable name, outer .env quotes, Server, Initial Catalog/Database, and authentication fields within the single connection string. |
| DNS | Azure SQL fully qualified hostname, private DNS and VPN requirements. |
| TCP/network | Outbound SQL traffic and the network route to Azure. A reachable port alone does not prove Azure SQL firewall access. |
| Azure firewall | Allow the appropriate client public IP or use the intended private endpoint/VPN. The app does not change firewall rules. |
| Authentication | SQL login/password or the connection string's supported Microsoft Entra method, plus account access to the database. |
| Certificate | Correct hostname, clock and trusted certificate chain. Do not disable certificate validation. |
| SQL permissions | Have the database owner review the account's grants. No permission bypasses are used. |
| Query timeout | Narrow the result, use indexed filters, or investigate blocking. Some writes might already be committed. |

References: [Microsoft Azure SQL connection troubleshooting](https://learn.microsoft.com/en-us/azure/azure-sql/database/troubleshoot-common-errors-issues?view=azuresql), [node-mssql driver documentation](https://tediousjs.github.io/node-mssql/).

## Project layout

```text
client/          React interface, CodeMirror, team roster, styling and CSV export
server/          Private connection configuration, diagnostics, schema/data APIs and safeguards
scripts/         Read-only command-line connection diagnosis
tests/           Automated tests and isolated browser fixture
dist/            Built browser files (generated)
.env             Your private SQL connection string (ignored; never committed)
.env.example     Empty connection-string template
```
"# DBMS-for-group-project-" 
