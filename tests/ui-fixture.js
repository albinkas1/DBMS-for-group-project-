// Explicit UI test harness. Entirely in memory. Never opens a database connection.
import { createApp } from '../server/app.js';
import { EventEmitter } from 'node:events';
const rows = [
  { id: '1', name: 'Connection diagnostics', status: 'Complete' },
  { id: '2', name: 'Schema explorer', status: 'Review' },
  { id: '3', name: 'Query safeguards', status: 'Complete' },
];
const columns = [
  { name: 'id', type: 'bigint', primaryKeyOrdinal: 1, isIdentity: true, nullable: false },
  { name: 'name', type: 'nvarchar', maxLength: 240, nullable: false },
  { name: 'status', type: 'nvarchar', maxLength: 80, nullable: true, defaultValue: "('New')" },
];
const info = {
  schema: 'dbo',
  name: 'project_tasks',
  type: 'U',
  objectId: 1,
  canInsert: 1,
  canUpdate: 1,
  canDelete: 1,
  columns,
  foreignKeys: [
    {
      name: 'FK_tasks_status',
      columnName: 'status',
      referencedSchema: 'dbo',
      referencedTable: 'statuses',
      referencedColumn: 'name',
      onDelete: 'NO_ACTION',
      onUpdate: 'CASCADE',
    },
  ],
  indexes: [
    {
      name: 'PK_project_tasks',
      type: 'CLUSTERED',
      isUnique: true,
      isPrimary: true,
      columnName: 'id',
      ordinal: 1,
    },
  ],
};
createApp({
  withDatabase: async (fn) => fn({ request: () => ({ query: async () => ({}) }) }),
  diagnose: async () => ({
    connected: true,
    database: 'UI test fixture (no database)',
    checkedAt: new Date().toISOString(),
    elapsedMs: 4,
    checks: ['Configuration', 'DNS', 'Network', 'Authentication & database'].map((name) => ({
      name,
      status: 'passed',
      detail: 'Simulated for isolated UI testing.',
    })),
    limits: { timeoutMs: 30000, maxRows: 1000 },
  }),
  catalog: async () => ({
    schemas: ['dbo'],
    objects: [
      { schemaName: 'dbo', name: 'project_tasks', type: 'U', objectId: 1 },
      { schemaName: 'dbo', name: 'active_tasks', type: 'V', objectId: 2 },
    ],
  }),
  objectInfo: async (pool, schema, name) => ({
    ...info,
    name,
    type: name === 'active_tasks' ? 'V' : 'U',
  }),
  tableData: async (pool, input) => {
    let selected = rows.filter((r) =>
      input.filters.every((f) =>
        f.operator === 'contains'
          ? String(r[f.column]).includes(f.value)
          : String(r[f.column]) === f.value,
      ),
    );
    if (input.sort)
      selected.sort(
        (a, b) =>
          String(a[input.sort]).localeCompare(String(b[input.sort])) *
          (input.direction === 'DESC' ? -1 : 1),
      );
    return {
      info: { ...info, name: input.name, type: input.name === 'active_tasks' ? 'V' : 'U' },
      rows: selected.map((values) => ({ values: { ...values }, editable: true })),
      hasNext: false,
      stableOrder: true,
      page: input.page,
      pageSize: input.pageSize,
      sort: input.sort || 'id',
    };
  },
  collectRequest: async (req, source, budget, onRequest) => {
    if (source.includes('BAD_SQL'))
      throw {
        code: 'EREQUEST',
        number: 102,
        lineNumber: 1,
        message: 'Incorrect syntax near BAD_SQL.',
      };
    if (source.includes('WAITFOR'))
      await new Promise((resolve, reject) =>
        onRequest({ cancel: () => reject({ code: 'ECANCEL' }) }),
      );
    return {
      recordsets: [{ columns, rows: rows.map((r) => columns.map((c) => r[c.name])) }],
      rowCounts: [3],
      rowCount: 3,
      elapsedMs: 8,
      truncated: false,
      messages: [],
    };
  },
  mutate: async (pool, p) => {
    if (p.action === 'insert')
      rows.push({ id: String(rows.length + 1), status: 'New', ...p.values });
    else {
      const index = rows.findIndex((r) => r.id === p.original.id);
      if (index < 0) throw new Error('Row missing');
      if (p.action === 'delete') rows.splice(index, 1);
      else rows[index] = { ...rows[index], ...p.values };
    }
    return { affectedRows: 1 };
  },
}).listen(3001, '127.0.0.1', () =>
  console.log('Isolated UI test fixture: http://127.0.0.1:3001 (no database connection)'),
);
