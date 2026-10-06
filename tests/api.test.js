import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createApp } from '../server/app.js';

test('local API enforces request security, confirmations, query history and validated CRUD', async (t) => {
  let dbCalls = 0,
    mutations = 0,
    executed = [];
  const app = createApp({
    withDatabase: async (fn) => {
      dbCalls++;
      return fn({ request: () => ({ query: async () => ({}) }) });
    },
    diagnose: async () => ({
      connected: false,
      checks: [{ name: 'Configuration', status: 'failed' }],
    }),
    collectRequest: async (req, source) => {
      executed.push(source);
      return {
        recordsets: [{ columns: [{ name: 'n', type: 'int' }], rows: [[1]] }],
        rowCount: 1,
        rowCounts: [1],
        elapsedMs: 2,
      };
    },
    mutate: async () => {
      mutations++;
      return { affectedRows: 1 };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(base + '/api/session').then((r) => r.json());
  async function call(path, body, options = {}) {
    const r = await fetch(base + '/api' + path, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        'X-DBMS-Token': session.token,
        ...options.headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  }
  assert.equal(
    (await call('/history', null, { headers: { 'X-DBMS-Token': 'wrong' } })).status,
    403,
  );
  assert.equal(
    (await call('/history', null, { headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  const rebindingStatus = await new Promise((resolve, reject) => {
    const req = http.get(base + '/api/session', { headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
  assert.equal((await call('/connection')).body.connected, false);
  assert.equal((await call('/query/run', { sql: 'DELETE FROM x' })).status, 409);
  assert.equal(dbCalls, 0);
  const prepared = await call('/query/prepare', { sql: 'DELETE FROM x' });
  assert.ok(prepared.body.confirmationToken);
  assert.equal(
    (
      await call('/query/run', {
        sql: 'DROP TABLE x',
        confirmationToken: prepared.body.confirmationToken,
      })
    ).status,
    409,
  );
  assert.equal(dbCalls, 0);
  const confirmation = (await call('/query/prepare', { sql: 'DELETE FROM x' })).body
    .confirmationToken;
  assert.equal(
    (
      await call('/query/run', {
        sql: 'DELETE FROM x',
        confirmationToken: confirmation,
        id: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal(
    (await call('/query/run', { sql: 'DELETE FROM x', confirmationToken: confirmation })).status,
    409,
  );
  assert.equal((await call('/query/run', { sql: 'SELECT 1' })).status, 200);
  assert.deepEqual(executed, ['DELETE FROM x', 'SELECT 1']);
  assert.equal((await call('/history')).body.history.length, 2);
  assert.equal((await call('/history', undefined, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/history')).body.history.length, 0);
  assert.equal(
    (await call('/data', { schema: 'dbo', name: 'x', direction: 'DESC; DROP TABLE x' })).status,
    400,
  );
  const payload = { schema: 'dbo', name: 'x', action: 'delete', values: {}, original: { id: 1 } };
  assert.equal((await call('/mutation/run', payload)).status, 409);
  assert.equal(mutations, 0);
  const token = (await call('/mutation/prepare', payload)).body.confirmationToken;
  assert.equal(
    (await call('/mutation/run', { ...payload, confirmationToken: token })).body.affectedRows,
    1,
  );
  assert.equal(mutations, 1);
  const env = await fetch(base + '/.env');
  assert.notEqual(env.status, 200);
  assert.ok(!(await env.text()).includes('AZURE_SQL_CONNECTION_STRING'));
});

test('SQL errors returned safely; cancelling during connection prevents execution', async (t) => {
  let release,
    executed = false;
  const app = createApp({
    withDatabase: async (fn) => {
      await new Promise((r) => {
        release = r;
      });
      return fn({});
    },
    collectRequest: async () => {
      executed = true;
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const { token } = await fetch(base + '/session').then((r) => r.json());
  const headers = { 'Content-Type': 'application/json', 'X-DBMS-Token': token };
  const id = randomUUID();
  const pending = fetch(base + '/query/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sql: 'SELECT 1', id }),
  });
  for (let i = 0; i < 30 && !release; i++) await new Promise((r) => setTimeout(r, 5));
  const cancel = await fetch(base + '/query/cancel', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id }),
  }).then((r) => r.json());
  assert.equal(cancel.cancelRequested, true);
  release();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal(executed, false);
});
