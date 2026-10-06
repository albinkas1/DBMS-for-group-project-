import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sql from 'mssql';
import { AppError, rememberSecrets } from './errors.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function environment() {
  let file = {};
  try {
    file = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  } catch (e) {
    if (e.code !== 'ENOENT')
      throw new AppError('The server cannot read .env. Check file access.', 'configuration');
  }
  return { ...file, ...process.env };
}
function bounded(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
export function limits() {
  const env = environment();
  return {
    timeoutMs: bounded(env.QUERY_TIMEOUT_MS, 30000, 1000, 120000),
    maxRows: bounded(env.MAX_RESULT_ROWS, 1000, 1, 5000),
    maxBytes: 2 * 1024 * 1024,
    maxCellBytes: 16384,
    maxRecordsets: 20,
  };
}
export function connectionConfig() {
  const raw = environment().AZURE_SQL_CONNECTION_STRING?.trim();
  if (!raw)
    throw new AppError(
      'AZURE_SQL_CONNECTION_STRING is empty or missing. Add the Azure SQL connection string to the project’s server .env file, then test again.',
      'configuration',
    );
  rememberSecrets({}, raw);
  let config;
  try {
    config = sql.ConnectionPool.parseConnectionString(raw);
  } catch {
    throw new AppError(
      'The connection string could not be parsed. Use the Azure SQL ADO.NET format: Server; Initial Catalog; User ID; Password.',
      'configuration',
    );
  }
  rememberSecrets(config, raw);
  if (!config.server || !config.database)
    throw new AppError(
      'The connection string must include Server and Database (or Initial Catalog).',
      'configuration',
    );
  if (
    !config.authentication &&
    (!config.authentication_type || config.authentication_type === 'default') &&
    (!config.user || !config.password)
  )
    throw new AppError(
      'The connection string needs SQL login credentials or a supported Microsoft Entra authentication method.',
      'configuration',
    );
  if (
    !Number.isInteger(config.port || 1433) ||
    (config.port || 1433) < 1 ||
    (config.port || 1433) > 65535
  )
    throw new AppError('The SQL server port must be between 1 and 65535.', 'configuration');
  config.connectionTimeout = 30000;
  config.requestTimeout = limits().timeoutMs;
  config.options = {
    ...config.options,
    encrypt: true,
    trustServerCertificate: false,
    appName: 'Local Azure SQL Workbench',
    useUTC: true,
    abortTransactionOnError: true,
  };
  config.stream = false;
  config.arrayRowMode = false;
  config.parseJSON = false;
  config.pool = { min: 0, max: 1, idleTimeoutMillis: 1000, acquireTimeoutMillis: 30000 };
  return config;
}
