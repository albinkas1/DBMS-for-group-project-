import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { quote, mutate, projection, tableData } from '../server/catalog.js';

function fakePool(columns, { type = 'U' } = {}) {
  const calls = [];
  return {
    calls,
    request() {
      const parameters = {};
      return {
        input(name, t, value) {
          parameters[name] = value;
          return this;
        },
        async query(source) {
          calls.push({ source, parameters });
          if (source.includes('DECLARE @id'))
            return {
              recordsets: [[{ type, canInsert: 1, canUpdate: 1, canDelete: 1 }], columns, [], []],
            };
          return { recordsets: [[{ affected: 1 }]] };
        },
      };
    },
  };
}
const columns = [
  { name: 'id', type: 'bigint', primaryKeyOrdinal: 1 },
  { name: 'name', type: 'nvarchar', maxLength: 200, nullable: true },
  { name: 'amount', type: 'decimal', precision: 28, scale: 8 },
];
test('identifiers are escaped; generated edits parameterize exact keys and original values', async () => {
  assert.equal(quote('a]b'), '[a]]b]');
  const pool = fakePool(columns),
    attack = "'; DROP TABLE users;--";
  await mutate(pool, {
    schema: 'dbo',
    name: 'x]y',
    action: 'update',
    values: { name: attack },
    original: { id: '9223372036854775800', name: 'old', amount: '100000000000000000.12345678' },
  });
  const call = pool.calls.at(-1);
  assert.ok(call.source.includes('[dbo].[x]]y]'));
  assert.ok(call.source.includes('BEGIN TRANSACTION'));
  assert.ok(call.source.includes('@@ROWCOUNT'));
  assert.ok(call.source.includes('WHERE [id]='));
  assert.ok(call.source.includes('[name]=CAST(@original'));
  assert.ok(!call.source.includes(attack));
  assert.ok(Object.values(call.parameters).includes(attack));
  assert.ok(Object.values(call.parameters).includes('9223372036854775800'));
});
test('missing primary keys, unknown columns and identity updates are rejected', async () => {
  await assert.rejects(
    mutate(fakePool([{ name: 'name', type: 'nvarchar' }]), {
      schema: 'dbo',
      name: 'x',
      action: 'delete',
      values: {},
      original: { name: 'one' },
    }),
    /primary key/,
  );
  await assert.rejects(
    mutate(fakePool(columns), {
      schema: 'dbo',
      name: 'x',
      action: 'update',
      values: { unknown: '1' },
      original: { id: '1' },
    }),
    /cannot be edited/,
  );
  await assert.rejects(
    mutate(fakePool([{ ...columns[0], isIdentity: true }]), {
      schema: 'dbo',
      name: 'x',
      action: 'update',
      values: { id: '2' },
      original: { id: '1' },
    }),
    /cannot be edited/,
  );
  await assert.rejects(
    mutate(fakePool(columns), {
      schema: 'dbo',
      name: 'x',
      action: 'delete',
      values: {},
      original: { name: 'x' },
    }),
    /primary key values/,
  );
  await assert.rejects(
    mutate(fakePool(columns, { type: 'V' }), {
      schema: 'dbo',
      name: 'x',
      action: 'delete',
      values: {},
      original: { id: '1' },
    }),
    /tables/,
  );
});
test('default insert and exact-number projections are supported', async () => {
  const pool = fakePool(columns);
  await mutate(pool, { schema: 'dbo', name: 'x', action: 'insert', values: {} });
  assert.match(pool.calls.at(-1).source, /INSERT INTO \[dbo\].\[x\] DEFAULT VALUES/);
  assert.equal(projection(columns[0]), 'CONVERT(nvarchar(100),[id]) AS [id]');
  assert.equal(projection(columns[2]), 'CONVERT(nvarchar(100),[amount]) AS [amount]');
});

test('pagination and filtering use bound values, stable sorting and an extra next-page row', async () => {
  const calls = [];
  const attack = "x'; DROP TABLE data;--";
  class Request extends EventEmitter {
    constructor() { super(); this.params = {}; }
    input(name, type, value) { this.params[name] = value; return this; }
    async query(source) {
      calls.push({ source, params: this.params });
      if (source.includes('DECLARE @id')) return { recordsets: [[{ type: 'U' }], columns, [], []] };
      if (!this.stream) return {};
      queueMicrotask(() => {
        this.emit('row', { id: '5', name: 'result', amount: '0.12345678' });
        this.emit('row', { id: '6', name: 'z'.repeat(17000), amount: '2.00000000' });
        this.emit('row', { id: '7', name: 'next page', amount: null });
        this.emit('done');
      });
    }
  }
  const pool = { request: () => new Request() };
  const result = await tableData(pool, { schema: 'dbo', name: 'data', page: 2, pageSize: 2, sort: 'name', direction: 'DESC', filters: [{ column: 'name', operator: 'eq', value: attack }] });
  const statement = calls.at(-1);
  assert.equal(statement.params.offset, 4);
  assert.equal(statement.params.size, 3);
  assert.equal(statement.params.filter0, attack);
  assert.ok(!statement.source.includes(attack));
  assert.match(statement.source, /ORDER BY \[name\] DESC,\[id\] ASC/);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].editable, true);
  assert.equal(result.rows[1].editable, false);
  assert.equal(result.hasNext, true);
  assert.equal(result.truncated, true);
  await assert.rejects(tableData(pool, { schema: 'dbo', name: 'data', page: 0, pageSize: 2, sort: 'missing', direction: 'ASC', filters: [] }), /cannot be sorted/);
});
