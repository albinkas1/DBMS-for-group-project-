import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, Confirmations } from '../server/safety.js';
import { safeError, rememberSecrets, redact } from '../server/errors.js';
import { connectionConfig } from '../server/config.js';
import { csv } from '../client/utils.js';

test('ordinary SELECT and quoted mutation words do not prompt', () => {
  for (const text of [
    'SELECT 1;',
    "SELECT 'DROP TABLE x', [UPDATE] FROM [data];",
    '/* SELECT /* nested */ safe */ SELECT 1 -- DELETE',
  ])
    assert.equal(analyze(text).requiresConfirmation, false);
});
test('destructive, ambiguous, dynamic and multi-statement batches require confirmation', () => {
  for (const text of [
    'DROP TABLE [x]',
    'TRUNCATE TABLE x',
    'DELETE FROM x',
    'UPDATE x SET a=1',
    "UPDATE x SET a='WHERE'",
    'UPDATE x SET a=(SELECT a FROM y WHERE b=1)',
    'SELECT 1; DROP TABLE x',
    "EXEC(N'DELETE FROM x')",
    'WITH a AS (SELECT * FROM x) DELETE FROM a',
    'SELECT * INTO y FROM x',
    'INSERT INTO x VALUES(1)',
    'CREATE TABLE x(id int)',
    'ALTER TABLE x ADD n int',
    'EXEC p',
    'MERGE x USING y ON x.id=y.id WHEN MATCHED THEN DELETE;',
    '; DELETE FROM x /* WHERE 1=0 */',
  ])
    assert.equal(analyze(text).requiresConfirmation, true, text);
});
test('unclosed tokens and oversized queries are rejected', () => {
  for (const text of ["SELECT 'bad", 'SELECT [bad', '/* bad', ' ', 'x'.repeat(100001)])
    assert.throws(() => analyze(text));
});
test('confirmation cannot be replayed or applied to changed SQL', () => {
  const gate = new Confirmations(),
    payload = { kind: 'query', sql: 'DELETE FROM x' };
  const token = gate.issue(payload);
  gate.consume(token, payload);
  assert.throws(() => gate.consume(token, payload));
  const other = gate.issue(payload);
  assert.throws(() => gate.consume(other, { ...payload, sql: 'DROP TABLE y' }));
  const expired = gate.issue(payload);
  gate.entries.get(expired).expires = Date.now() - 1;
  assert.throws(() => gate.consume(expired, payload));
});
test('connection strings enforce TLS and retain quoted password delimiters', () => {
  const original = process.env.AZURE_SQL_CONNECTION_STRING;
  try {
    process.env.AZURE_SQL_CONNECTION_STRING =
      'Server=tcp:example.database.windows.net,1433;Initial Catalog=project;User ID=fixture_login;Password="secret;#42";Encrypt=False;TrustServerCertificate=True;';
    const c = connectionConfig();
    assert.equal(c.server, 'example.database.windows.net');
    assert.equal(c.password, 'secret;#42');
    assert.equal(c.options.encrypt, true);
    assert.equal(c.options.trustServerCertificate, false);
    assert.equal(c.connectionTimeout, 30000);
    process.env.AZURE_SQL_CONNECTION_STRING =
      'Server=example.database.windows.net;Database=project;Authentication=Active Directory Integrated;token=test-token-for-unit-tests;';
    assert.equal(connectionConfig().authentication_type, 'azure-active-directory-access-token');
    process.env.AZURE_SQL_CONNECTION_STRING = '';
    assert.throws(() => connectionConfig(), /empty or missing/);
  } finally {
    if (original === undefined) delete process.env.AZURE_SQL_CONNECTION_STRING;
    else process.env.AZURE_SQL_CONNECTION_STRING = original;
  }
});
test('credential strings never appear in errors or nested API values', () => {
  rememberSecrets(
    { user: 'fixture_user', password: 'fixture_password' },
    'fixture_connection_string',
  );
  const output = JSON.stringify(
    redact({ a: ['fixture_user', 'fixture_password', 'fixture_connection_string'] }),
  );
  assert.doesNotMatch(output, /fixture_/);
  assert.equal(
    safeError({ code: 'ELOGIN', message: 'fixture_password' }).category,
    'authentication',
  );
  assert.equal(safeError({ number: 40615, message: 'blocked' }).category, 'network');
  assert.equal(safeError({ number: 4060, message: 'missing' }).category, 'configuration');
  const sql = safeError({
    number: 207,
    code: 'EREQUEST',
    message: "Invalid column 'fixture_password'.",
    lineNumber: 4,
  });
  assert.equal(sql.line, 4);
  assert.doesNotMatch(sql.message, /fixture_password/);
});
test('CSV quotes values, preserves rows and neutralizes spreadsheet formulas', () => {
  const output = csv(
    [{ name: 'a' }, { name: 'b' }],
    [
      [null, 'one,"two"\nthree'],
      ['=1+1', ' @SUM(A1)'],
      ['safe', 42],
    ],
  );
  assert.ok(output.startsWith('\uFEFF"a","b"\r\n'));
  assert.ok(output.includes('"one,""two""\nthree"'));
  assert.ok(output.includes('"\'=1+1"'));
  assert.ok(output.includes('"\' @SUM(A1)"'));
  assert.ok(output.endsWith('"safe","42"'));
});
