import sql from 'mssql';
import dns from 'node:dns/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { connectionConfig, limits } from './config.js';
import { AppError, safeError, redact } from './errors.js';

let connections = 0;
export async function withDatabase(fn, config = connectionConfig()) {
  if (connections >= 4)
    throw new AppError(
      'Four database operations are already running. Wait for one to finish.',
      'busy',
      429,
    );
  connections++;
  const pool = new sql.ConnectionPool(config);
  pool.on('error', () => {}); // Never log a driver object: it can contain credentials.
  try {
    await pool.connect();
    return await fn(pool);
  } finally {
    await pool.close().catch(() => {});
    connections--;
  }
}

async function tcpCheck(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const finish = (error) => {
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(5000, () =>
      finish(
        new AppError(
          'TCP connection timed out. Check outbound SQL access, Azure networking and VPN.',
          'network',
        ),
      ),
    );
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}
export async function diagnose() {
  const start = performance.now();
  const checks = [];
  try {
    const config = connectionConfig();
    checks.push({
      name: 'Configuration',
      status: 'passed',
      detail: 'Server configuration is present. Encryption and certificate validation are enabled.',
    });
    let timer;
    try {
      await Promise.race([
        dns.lookup(config.server),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AppError(
                  'DNS lookup timed out. Check the server name and VPN/DNS configuration.',
                  'network',
                ),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    checks.push({ name: 'DNS', status: 'passed', detail: 'The server name resolves.' });
    await tcpCheck(config.server, config.port || 1433);
    checks.push({
      name: 'Network',
      status: 'passed',
      detail: 'The SQL TCP port is reachable. Azure login and firewall checks follow.',
    });
    const result = await withDatabase(
      (pool) => pool.request().query('SELECT 1 AS ok, DB_NAME() AS databaseName;'),
      config,
    );
    checks.push({
      name: 'Authentication & database',
      status: 'passed',
      detail: 'Encrypted sign-in and a read-only SELECT succeeded.',
    });
    return {
      connected: true,
      checks,
      database: result.recordset[0].databaseName,
      elapsedMs: Math.round(performance.now() - start),
      limits: limits(),
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    const error = safeError(e);
    checks.push({
      name: ['Configuration', 'DNS', 'Network', 'Authentication & database'][checks.length],
      status: 'failed',
      detail: error.message,
    });
    return {
      connected: false,
      checks,
      error,
      elapsedMs: Math.round(performance.now() - start),
      limits: limits(),
      checkedAt: new Date().toISOString(),
    };
  }
}

export function cell(value, maxLength = 16384) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return '0x' + value.toString('hex').slice(0, maxLength);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'object') value = JSON.stringify(value);
  if (typeof value === 'string' && value.length > maxLength)
    return value.slice(0, maxLength) + '… [value truncated]';
  return value;
}

export function collectRequest(request, source, budget = limits(), onRequest = () => {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const recordsets = [],
      rowCounts = [],
      messages = [];
    let current,
      count = 0,
      bytes = 0,
      truncated = false,
      failure,
      timedOut = false;
    request.stream = true;
    request.arrayRowMode = true;
    const timer = setTimeout(() => {
      timedOut = true;
      request.cancel();
    }, budget.timeoutMs);
    request.on('recordset', (columns) => {
      current = {
        columns: Object.values(columns).map((c, index) => ({
          name: c.name || `(column ${index + 1})`,
          type: c.type?.declaration || c.type?.name || 'unknown',
          nullable: !!c.nullable,
          length: c.length,
          precision: c.precision,
          scale: c.scale,
        })),
        rows: [],
      };
      if (recordsets.length < budget.maxRecordsets) recordsets.push(current);
      else {
        current = null;
        truncated = true;
      }
    });
    request.on('row', (row) => {
      if (!current || count >= budget.maxRows || bytes >= budget.maxBytes) {
        truncated = true;
        return;
      }
      const raw = Array.isArray(row) ? row : Object.values(row);
      if (
        raw.some(
          (v) =>
            (typeof v === 'string' && v.length > budget.maxCellBytes) ||
            (Buffer.isBuffer(v) && v.length * 2 > budget.maxCellBytes),
        )
      )
        truncated = true;
      const values = raw.map((v) => cell(v, budget.maxCellBytes));
      const size = Buffer.byteLength(JSON.stringify(values));
      if (bytes + size > budget.maxBytes) {
        truncated = true;
        return;
      }
      bytes += size;
      count++;
      current.rows.push(values);
    });
    request.on('rowsaffected', (n) => {
      if (rowCounts.length < 100) rowCounts.push(n);
    });
    request.on('info', (info) => {
      if (messages.length < 30) messages.push(redact(String(info.message)).slice(0, 1000));
    });
    request.on('error', (e) => {
      failure ??= e;
    });
    request.on('done', () => {
      clearTimeout(timer);
      if (timedOut)
        return reject(
          new AppError(
            'Query time limit reached. Execution was cancelled. Earlier statements may already have committed; check before retrying.',
            'timeout',
            408,
          ),
        );
      if (failure) return reject(failure);
      resolve({
        recordsets,
        rowCounts,
        messages,
        rowCount: count,
        elapsedMs: Math.round(performance.now() - start),
        truncated,
      });
    });
    onRequest(request);
    try {
      request.batch(source).catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
