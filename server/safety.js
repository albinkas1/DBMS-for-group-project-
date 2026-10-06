import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';

// This intentionally conservative lexer is a confirmation gate, not a SQL parser.
// Only SELECT batches without write-capable keywords can skip confirmation.
export function tokens(source) {
  const result = [];
  for (let i = 0; i < source.length; ) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (source.slice(i, i + 2) === '--') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.slice(i, i + 2) === '/*') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.slice(i, i + 2) === '/*') {
          depth++;
          i += 2;
        } else if (source.slice(i, i + 2) === '*/') {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new AppError('An SQL comment is not closed.');
      continue;
    }
    if (c === "'" || c === '"' || c === '[') {
      const end = c === '[' ? ']' : c;
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === end) {
          if (source[i + 1] === end) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw new AppError('An SQL string or identifier is not closed.');
      result.push('QUOTED');
      continue;
    }
    const word = /^[a-zA-Z_#@][\w@$#]*/.exec(source.slice(i));
    if (word) {
      result.push(word[0].toUpperCase());
      i += word[0].length;
    } else {
      result.push(c);
      i++;
    }
  }
  return result;
}
export function analyze(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 100000)
    throw new AppError('Enter SQL between 1 and 100,000 characters.');
  const words = tokens(source).filter((t) => t !== ';');
  const destructive = words.includes('DROP') || words.includes('TRUNCATE');
  const changes = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'MERGE',
    'CREATE',
    'ALTER',
    'DROP',
    'TRUNCATE',
    'EXEC',
    'EXECUTE',
    'INTO',
    'GRANT',
    'DENY',
    'REVOKE',
    'DBCC',
    'BACKUP',
    'RESTORE',
    'OPENROWSET',
    'OPENQUERY',
    'OPENDATASOURCE',
    'NEXT',
    'USE',
    'SET',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'WAITFOR',
    'KILL',
    'SHUTDOWN',
    'DISABLE',
    'ENABLE',
    'BULK',
    'RECONFIGURE',
    'CHECKPOINT',
    'SEND',
    'RECEIVE',
    'END',
    'CLOSE',
    'DEALLOCATE',
  ];
  const requiresConfirmation = words[0] !== 'SELECT' || words.some((w) => changes.includes(w));
  const warnings = [];
  if (destructive)
    warnings.push('DROP or TRUNCATE can permanently remove objects or all their rows.');
  if (words.includes('UPDATE') || words.includes('DELETE'))
    warnings.push(
      'This batch contains UPDATE or DELETE. Review each statement carefully: a missing or ineffective WHERE clause can affect every row.',
    );
  if (requiresConfirmation)
    warnings.push(
      'This batch may change data or schema. Only your configured database account’s permissions apply. Earlier statements can commit even if a later statement fails or is cancelled.',
    );
  return { requiresConfirmation, destructive, warnings };
}

export class Confirmations {
  constructor() {
    this.entries = new Map();
  }
  digest(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
  issue(payload) {
    this.prune();
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value);
    const token = randomBytes(24).toString('hex');
    this.entries.set(token, { digest: this.digest(payload), expires: Date.now() + 120000 });
    return token;
  }
  prune() {
    for (const [key, value] of this.entries)
      if (value.expires <= Date.now()) this.entries.delete(key);
  }
  consume(token, payload) {
    const record = this.entries.get(token);
    this.entries.delete(token);
    if (!record || record.expires <= Date.now() || record.digest !== this.digest(payload))
      throw new AppError(
        'Confirmation expired or the statement changed. Review and confirm again.',
        'confirmation',
        409,
      );
  }
}
