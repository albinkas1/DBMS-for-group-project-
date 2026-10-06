export class AppError extends Error {
  constructor(message, category = 'validation', status = 400, extra = {}) {
    super(message);
    this.category = category;
    this.status = status;
    this.extra = extra;
  }
}

const secrets = new Set();
export function rememberSecrets(config, raw) {
  if (raw) secrets.add(raw);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /password|secret|token|user(name)?|clientid/i.test(key) &&
        typeof item === 'string' &&
        item
      )
        secrets.add(item);
      else if (typeof item === 'object') visit(item);
    }
  }
  visit(config);
}
export function redact(value) {
  if (typeof value === 'string') {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length))
      value = value.split(secret).join('[redacted]');
    return value.replace(
      /((?:password|pwd|client secret|access token)\s*=\s*)(?:"[^"]*"|'[^']*'|[^;\r\n]*)/gi,
      '$1[redacted]',
    );
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k), redact(v)]));
  return value;
}

export function safeError(error) {
  if (error instanceof AppError)
    return { category: error.category, message: error.message, ...error.extra };
  const number = Number(error?.number || error?.originalError?.info?.number) || undefined;
  const code = String(error?.code || '');
  const text = String(error?.message || '');
  if (number === 40615 || /firewall|not allowed to access/i.test(text))
    return {
      category: 'network',
      message:
        'Azure SQL rejected this network. In Azure, allow this computer’s current public IP, or connect through the required private network/VPN.',
      number,
    };
  if (number === 4060)
    return {
      category: 'configuration',
      message:
        'The database is unavailable or this login cannot open it. Check Initial Catalog / Database and the login’s access.',
      number,
    };
  if (code === 'ELOGIN' || number === 18456 || /credential|authentication|login failed/i.test(text))
    return {
      category: 'authentication',
      message:
        'Azure SQL rejected authentication. Check the login, password or Entra configuration in the server .env and confirm that the account can access this database.',
      number,
    };
  if (/certificate|self.signed|TLS|SSL/i.test(text))
    return {
      category: 'network',
      message:
        'The encrypted connection could not verify the server certificate. Check the Azure server name, system clock and trusted certificate chain. Certificate verification remains enabled.',
    };
  if (code === 'ETIMEOUT' || /timeout|timed out/i.test(text))
    return {
      category: 'timeout',
      message:
        'The operation exceeded its time limit. For a connection, check Azure networking and VPN access. For a query, narrow the query or investigate blocking. Earlier statements may already have committed.',
    };
  if (code === 'ECANCEL')
    return {
      category: 'cancelled',
      message:
        'Execution was cancelled. Earlier statements may already have committed; check the database before retrying.',
    };
  if (/ESOCKET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENOCONN|ECONNCLOSED/.test(code))
    return {
      category: 'network',
      message:
        'The SQL server could not be reached. Check the server name, DNS, Azure firewall rules, outbound TCP access and any required VPN.',
    };
  if (number || code === 'EREQUEST')
    return {
      category: 'sql',
      message: redact(text).slice(0, 1200) || 'SQL Server rejected the statement.',
      number,
      line: error?.lineNumber,
      state: error?.state,
    };
  return {
    category: 'server',
    message:
      'The operation could not be completed. Check the connection and try again. No credentials or internal error details are exposed.',
  };
}
