import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { collectRequest } from '../server/database.js';

const budget = { timeoutMs: 1000, maxRows: 2, maxBytes: 1024, maxCellBytes: 50, maxRecordsets: 2 };
class Request extends EventEmitter {
  constructor(run) {
    super();
    this.run = run;
    this.cancelled = false;
  }
  batch() {
    queueMicrotask(() => this.run(this));
    return Promise.resolve();
  }
  cancel() {
    this.cancelled = true;
    this.emit('error', { code: 'ECANCEL' });
    this.emit('done');
  }
}
test('streamed results bound row count and preserve duplicate column names and counts', async () => {
  const req = new Request((r) => {
    r.emit('recordset', [
      { name: 'n', type: { declaration: 'int' } },
      { name: 'n', type: { declaration: 'int' } },
    ]);
    for (let i = 0; i < 20; i++) r.emit('row', [i, i + 1]);
    r.emit('rowsaffected', 20);
    r.emit('done');
  });
  const result = await collectRequest(req, 'SELECT', budget);
  assert.equal(result.recordsets[0].columns.length, 2);
  assert.deepEqual(result.recordsets[0].rows, [
    [0, 1],
    [1, 2],
  ]);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.rowCounts, [20]);
  assert.equal(req.cancelled, false);
});
test('streamed byte, cell and recordset limits apply', async () => {
  const req = new Request((r) => {
    for (let i = 0; i < 4; i++) {
      r.emit('recordset', [{ name: 'long' }]);
      r.emit('row', ['z'.repeat(1000)]);
    }
    r.emit('done');
  });
  const result = await collectRequest(req, 'SELECT', { ...budget, maxBytes: 500 });
  assert.equal(result.recordsets.length, 2);
  assert.ok(result.recordsets[0].rows[0][0].length < 100);
  assert.ok(result.truncated);
});
test('streaming SQL errors fail and hard timeout calls driver cancellation', async () => {
  const fail = new Request((r) => {
    r.emit('error', new Error('test error'));
    r.emit('done');
  });
  await assert.rejects(collectRequest(fail, 'SELECT', budget), /test error/);
  const slow = new Request(() => {});
  await assert.rejects(collectRequest(slow, 'SELECT', { ...budget, timeoutMs: 15 }), /time limit/);
  assert.equal(slow.cancelled, true);
});
