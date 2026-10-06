import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Database,
  Cable,
  Code2,
  History,
  Search,
  ChevronRight,
  ChevronDown,
  Table2,
  Eye,
  RefreshCw,
  Play,
  Square,
  Download,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Clock3,
  KeyRound,
  Columns3,
  ArrowUp,
  ArrowDown,
  Filter,
  FolderTree,
  Terminal,
  Link2,
  ListTree,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Users,
} from 'lucide-react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view';
import {
  defaultKeymap,
  history as editorHistory,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { sql, MSSQL } from '@codemirror/lang-sql';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { autocompletion } from '@codemirror/autocomplete';
import { display, exportCsv, typeLabel } from './utils.js';
import './style.css';
import Team from './Team.jsx';

let sessionToken;
async function api(path, body, method) {
  if (!sessionToken) {
    const r = await fetch('/api/session');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Cannot open the local session.');
    sessionToken = data.token;
  }
  const response = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-DBMS-Token': sessionToken },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const e = new Error(data.error?.message || 'The request could not be completed.');
    e.details = data.error;
    throw e;
  }
  return data;
}
const q = (name) => '[' + name.replaceAll(']', ']]') + ']';
function IconButton({ title, children, ...props }) {
  return (
    <button className="icon-button" aria-label={title} title={title} {...props}>
      {children}
    </button>
  );
}
function ErrorBox({ error }) {
  if (!error) return null;
  const d = error.details || error;
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>
          {d.category
            ? d.category.charAt(0).toUpperCase() + d.category.slice(1) + ' error'
            : 'Unable to complete action'}
        </strong>
        <p>{error.message || d.message}</p>
        {d.number && (
          <small>
            SQL {d.number}
            {d.line ? ` · Line ${d.line}` : ''}
          </small>
        )}
      </div>
    </div>
  );
}
function Empty({ icon: Icon = Database, title, children }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={30} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({ title, children, onClose, footer, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton title="Close dialog" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
function Confirm({ confirmation, onCancel, onConfirm }) {
  const [word, setWord] = useState('');
  return (
    <Modal
      title="Review database change"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" disabled={word !== 'RUN'} onClick={onConfirm}>
            Confirm and run
          </button>
        </>
      }
    >
      <div className="confirm-symbol">
        <ShieldCheck size={24} />
      </div>
      {confirmation.warnings.map((w, i) => (
        <p key={i}>{w}</p>
      ))}
      <pre className="review-sql">{confirmation.preview}</pre>
      <label>
        Type <strong>RUN</strong> to confirm this exact operation.
        <input
          autoComplete="off"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="RUN"
          autoFocus
        />
      </label>
      <small>
        Confirmation expires after two minutes. Changes are not automatically reversible.
      </small>
    </Modal>
  );
}

function SqlEditor({ value, onChange, onRun }) {
  const element = useRef(),
    view = useRef(),
    change = useRef(onChange),
    run = useRef(onRun);
  change.current = onChange;
  run.current = onRun;
  useEffect(() => {
    view.current = new EditorView({
      parent: element.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          editorHistory(),
          bracketMatching(),
          autocompletion(),
          sql({ dialect: MSSQL }),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                run.current();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({
            'aria-label': 'SQL query editor',
            spellcheck: 'false',
          }),
          EditorView.theme(
            {
              '&': {
                height: '100%',
                fontSize: '14px',
                backgroundColor: '#131920',
                color: '#e2e8f0',
              },
              '.cm-content': {
                fontFamily: 'Consolas, "Cascadia Code", monospace',
                padding: '22px 0',
                caretColor: '#9be8c4',
              },
              '.cm-line': { padding: '0 22px' },
              '.cm-gutters': {
                background: '#131920',
                color: '#667487',
                border: 'none',
                padding: '22px 8px 0 16px',
              },
              '.cm-activeLine': { background: '#1a242d' },
              '.cm-activeLineGutter': { background: 'transparent', color: '#a3b5c8' },
              '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
                background: '#315546 !important',
              },
              '.cm-scroller': { overflow: 'auto' },
              '.cm-tooltip': {
                background: '#202b37',
                color: '#e2e8f0',
                border: '1px solid #3b4b5d',
              },
            },
            { dark: true },
          ),
        ],
      }),
    });
    return () => view.current.destroy();
  }, []);
  useEffect(() => {
    if (view.current && value !== view.current.state.doc.toString())
      view.current.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: value },
      });
  }, [value]);
  return <div className="sql-editor" ref={element} />;
}

function DataGrid({ columns, rows, sort, direction, onSort, rowActions }) {
  return (
    <div className="grid-scroll">
      <table className="data-grid">
        <thead>
          <tr>
            <th className="row-number">#</th>
            {columns.map((c, i) => (
              <th key={i}>
                <button
                  disabled={!onSort}
                  onClick={() => onSort?.(c.name)}
                  title={`${c.name}: ${c.type}${c.nullable ? ' · nullable' : ''}`}
                >
                  <span>
                    {c.primaryKeyOrdinal ? <KeyRound size={12} /> : null}
                    {c.name}
                  </span>
                  {sort === c.name ? (
                    direction === 'ASC' ? (
                      <ArrowUp size={13} />
                    ) : (
                      <ArrowDown size={13} />
                    )
                  ) : null}
                  <small>{c.maxLength !== undefined ? typeLabel(c) : c.type}</small>
                </button>
              </th>
            ))}
            {rowActions && <th className="row-actions-heading">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="row-number">{i + 1}</td>
              {columns.map((c, j) => {
                const v = Array.isArray(row) ? row[j] : row[c.name];
                return (
                  <td key={j} title={display(v)}>
                    <span className={v === null ? 'null-value' : ''}>{display(v)}</span>
                  </td>
                );
              })}
              {rowActions && <td className="row-actions">{rowActions(i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="no-rows">No rows returned.</div>}
    </div>
  );
}

function Connection({ connection, checking, onCheck, error }) {
  const ready = connection?.connected;
  const checks = connection?.checks || [];
  return (
    <div className="connection-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR DATABASE, CONNECTED SECURELY</span>
          <h1>Connection</h1>
          <p>Check the path from this workspace to Azure SQL.</p>
        </div>
        <button className="primary" disabled={checking} onClick={onCheck}>
          <RefreshCw size={16} className={checking ? 'spin' : ''} />
          {checking ? 'Testing connection…' : 'Test connection'}
        </button>
      </div>
      <section className="connection-card">
        <div className="connection-identity">
          <div className="azure-mark">
            <Database size={31} />
          </div>
          <div>
            <h2>Azure SQL Database</h2>
            <p>{ready ? connection.database : 'SQL connection string'}</p>
          </div>
          <span className={'status-chip ' + (ready ? 'success' : 'pending')}>
            {checking ? <Loader2 size={13} className="spin" /> : <span className="status-dot" />}
            {checking ? 'Checking' : ready ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div className="connection-summary">
          <ShieldCheck size={20} />
          <div>
            <strong>Your connection string stays private</strong>
            <p>
              The app reads your SQL connection string from .env. It is never sent to the browser.
            </p>
          </div>
        </div>
        <div className="connection-facts">
          <div>
            <small>CONNECTION SOURCE</small>
            <span>SQL connection string · .env</span>
          </div>
          <div>
            <small>TRANSPORT</small>
            <span>Encrypted · certificate verified</span>
          </div>
          <div>
            <small>ACCESS</small>
            <span>Configured account permissions</span>
          </div>
        </div>
      </section>
      <div className="connection-lower">
        <section className="panel">
          <div className="section-heading">
            <h2>Connection checks</h2>
            {connection && <span className="muted">{connection.elapsedMs} ms</span>}
          </div>
          <div className="checks">
            {['Configuration', 'DNS', 'Network', 'Authentication & database'].map((name, i) => {
              const check = checks[i];
              return (
                <div className={'check-row ' + (check?.status || 'waiting')} key={name}>
                  <span className="check-icon">
                    {check?.status === 'passed' ? (
                      <Check size={16} />
                    ) : check?.status === 'failed' ? (
                      <X size={16} />
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </span>
                  <div>
                    <strong>{name}</strong>
                    <p>{check?.detail || 'Waiting for the previous check.'}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {connection?.checkedAt && (
            <div className="panel-foot">
              Last checked at {new Date(connection.checkedAt).toLocaleTimeString()}
            </div>
          )}
        </section>
        <section className="panel setup">
          <div className="section-heading">
            <h2>{ready ? 'Ready to explore' : 'Set up your connection'}</h2>
            <Cable size={17} />
          </div>
          {ready ? (
            <>
              <p>
                Browse schemas and tables from the explorer, or open the SQL editor to run a query.
              </p>
              <div className="note">
                <ShieldCheck size={18} />
                <span>
                  Connection checks only run a read-only SELECT. No schema or data changes are made.
                </span>
              </div>
            </>
          ) : (
            <>
              <p>
                Add your connection string to <code>.env</code> in the project folder:
              </p>
              <div className="env-code">
                AZURE_SQL_CONNECTION_STRING=<span>'your connection string'</span>
              </div>
              <p>
                Use the Azure SQL connection string from your Azure portal. Keep the value quoted
                and never put it in browser code.
              </p>
              <p>
                Save the file, then choose <strong>Test connection</strong>. Changes are picked up
                automatically.
              </p>
              <a
                href="https://learn.microsoft.com/en-us/azure/azure-sql/database/troubleshoot-common-errors-issues?view=azuresql"
                target="_blank"
                rel="noreferrer"
              >
                Azure connection troubleshooting
              </a>
            </>
          )}
          <div className="limits">
            <span>
              <Clock3 size={15} />
              {(connection?.limits?.timeoutMs || 30000) / 1000}s query timeout
            </span>
            <span>
              <Table2 size={15} />
              {(connection?.limits?.maxRows || 1000).toLocaleString()} result rows
            </span>
          </div>
        </section>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function RowForm({ info, row, action, onClose, onSubmit, busy, error }) {
  const supported = [
    'bigint',
    'int',
    'smallint',
    'tinyint',
    'bit',
    'decimal',
    'numeric',
    'money',
    'smallmoney',
    'float',
    'real',
    'date',
    'datetime',
    'datetime2',
    'smalldatetime',
    'datetimeoffset',
    'time',
    'char',
    'varchar',
    'nchar',
    'nvarchar',
    'text',
    'ntext',
    'uniqueidentifier',
    'binary',
    'varbinary',
    'image',
    'xml',
  ];
  const columns = info.columns.filter(
    (c) => supported.includes(c.type) && !c.isIdentity && !c.isComputed && !c.generatedAlways,
  );
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      columns.map((c) => [
        c.name,
        {
          include: action === 'insert' && !c.nullable && !c.defaultValue,
          value: row?.[c.name] ?? '',
          isNull: action === 'update' && row?.[c.name] === null,
        },
      ]),
    ),
  );
  const change = (name, patch) =>
    setValues((old) => ({ ...old, [name]: { ...old[name], ...patch } }));
  return (
    <Modal
      wide
      title={`${action === 'insert' ? 'Insert' : 'Edit'} row · ${info.schema}.${info.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              onSubmit(
                Object.fromEntries(
                  Object.entries(values)
                    .filter(([, v]) => v.include)
                    .map(([k, v]) => [k, v.isNull ? null : v.value]),
                ),
              )
            }
          >
            Review change
          </button>
        </>
      }
    >
      <p className="muted">
        {action === 'insert'
          ? 'Checked fields will be supplied. Unchecked fields use their database default. Identity and generated columns are omitted.'
          : 'Only checked fields will be updated. Primary keys and original values identify the row; a changed row must be refreshed.'}
      </p>
      <ErrorBox error={error} />
      <div className="row-fields">
        {columns.map((c) => (
          <div className="row-field" key={c.name}>
            <label className="field-toggle">
              <input
                type="checkbox"
                checked={values[c.name].include}
                onChange={(e) => change(c.name, { include: e.target.checked })}
              />
              <span>
                {c.name}
                <small>
                  {typeLabel(c)}
                  {c.primaryKeyOrdinal ? ' · primary key' : ''}
                </small>
              </span>
            </label>
            <input
              aria-label={`Value for ${c.name}`}
              disabled={!values[c.name].include || values[c.name].isNull}
              value={String(values[c.name].value)}
              placeholder={c.defaultValue ? `Default: ${c.defaultValue}` : 'Enter value'}
              onChange={(e) => change(c.name, { value: e.target.value })}
            />
            {c.nullable && (
              <label className="null-toggle">
                <input
                  type="checkbox"
                  checked={values[c.name].isNull}
                  disabled={!values[c.name].include}
                  onChange={(e) => change(c.name, { isNull: e.target.checked })}
                />
                NULL
              </label>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Structure({ info, tab }) {
  if (tab === 'Columns')
    return (
      <div className="grid-scroll">
        <table className="structure-table">
          <thead>
            <tr>
              {['Column', 'Type', 'Nullable', 'Default / computed', 'Properties'].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {info.columns.map((c) => (
              <tr key={c.name}>
                <td className="column-name">
                  {c.primaryKeyOrdinal && <KeyRound size={14} />} {c.name}
                </td>
                <td>
                  <code>{typeLabel(c)}</code>
                  {c.declaredType !== c.type && <small> {c.declaredType}</small>}
                </td>
                <td>{c.nullable ? 'Yes' : 'No'}</td>
                <td>
                  <code>{c.defaultValue || c.computedDefinition || '—'}</code>
                </td>
                <td>
                  {[
                    c.primaryKeyOrdinal && `Primary key ${c.primaryKeyOrdinal}`,
                    c.isIdentity && 'Identity',
                    c.isComputed && 'Computed',
                    !!c.generatedAlways && 'Generated',
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (tab === 'Relations')
    return info.foreignKeys.length ? (
      <div className="grid-scroll">
        <table className="structure-table">
          <thead>
            <tr>
              {['Foreign key', 'Column', 'References', 'On delete', 'On update'].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {info.foreignKeys.map((f, i) => (
              <tr key={i}>
                <td>{f.name}</td>
                <td>{f.columnName}</td>
                <td>
                  <code>
                    {f.referencedSchema}.{f.referencedTable}.{f.referencedColumn}
                  </code>
                </td>
                <td>{f.onDelete}</td>
                <td>{f.onUpdate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty icon={Link2} title="No foreign keys">
        No outgoing foreign keys are visible for this object.
      </Empty>
    );
  return info.indexes.length ? (
    <div className="grid-scroll">
      <table className="structure-table">
        <thead>
          <tr>
            {['Index', 'Type', 'Column', 'Order', 'Properties', 'Filter'].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {info.indexes.map((x, i) => (
            <tr key={i}>
              <td>{x.name}</td>
              <td>{x.type}</td>
              <td>{x.columnName}</td>
              <td>{x.included ? 'Included' : x.descending ? 'DESC' : 'ASC'}</td>
              <td>
                {[x.isPrimary && 'Primary key', x.isUnique && 'Unique']
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </td>
              <td>
                <code>{x.filter || '—'}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty icon={ListTree} title="No indexes">
      No indexes are visible for this object.
    </Empty>
  );
}

function Explorer({ object, onQuery, onChanged, askConfirm, toast }) {
  const [info, setInfo] = useState(null),
    [data, setData] = useState(null),
    [tab, setTab] = useState('Data'),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState(50),
    [sort, setSort] = useState(''),
    [direction, setDirection] = useState('ASC'),
    [filters, setFilters] = useState([]),
    [draft, setDraft] = useState({ column: '', operator: 'eq', value: '' }),
    [showFilters, setShowFilters] = useState(false),
    [rowForm, setRowForm] = useState(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api('/object?' + new URLSearchParams({ schema: object.schemaName, name: object.name }))
      .then((value) => {
        if (alive) {
          setInfo(value);
          setDraft((d) => ({ ...d, column: value.columns[0]?.name || '' }));
        }
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [object, revision]);
  useEffect(() => {
    if (tab !== 'Data') return;
    let alive = true;
    setLoading(true);
    setData(null);
    setError(null);
    api('/data', {
      schema: object.schemaName,
      name: object.name,
      page,
      pageSize,
      sort: sort || undefined,
      direction,
      filters,
    })
      .then((d) => {
        if (alive) {
          setData(d);
          setInfo(d.info);
        }
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [object, page, pageSize, sort, direction, filters, tab, revision]);
  async function mutation(action, row, values = {}) {
    setBusy(true);
    setError(null);
    const payload = {
      schema: object.schemaName,
      name: object.name,
      action,
      values,
      ...(row ? { original: row } : {}),
    };
    try {
      const prepared = await api('/mutation/prepare', payload);
      const ok = await askConfirm({
        warnings: prepared.warnings,
        preview: `${action.toUpperCase()} · ${object.schemaName}.${object.name}\n${JSON.stringify(action === 'delete' ? Object.fromEntries(info.columns.filter((c) => c.primaryKeyOrdinal).map((c) => [c.name, row[c.name]])) : values, null, 2)}`,
      });
      if (!ok) return;
      const result = await api('/mutation/run', {
        ...payload,
        confirmationToken: prepared.confirmationToken,
      });
      setRowForm(null);
      setRevision((n) => n + 1);
      toast(
        `${result.affectedRows} row ${action === 'delete' ? 'deleted' : action === 'insert' ? 'inserted' : 'updated'}.`,
      );
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!info && loading)
    return (
      <div className="loading-view">
        <Loader2 className="spin" />
        Loading object…
      </div>
    );
  return (
    <div className="explorer-page">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">
            {object.type === 'V' ? 'VIEW' : 'TABLE'} / {object.schemaName}
          </span>
          <h1>{object.name}</h1>
          <p>
            {info?.columns.length || 0} columns ·{' '}
            {info?.columns.filter((c) => c.primaryKeyOrdinal).length || 0} primary key columns
          </p>
        </div>
        <div className="button-group">
          <button
            onClick={() =>
              onQuery(`SELECT TOP (50) *\nFROM ${q(object.schemaName)}.${q(object.name)};`)
            }
          >
            <Code2 size={16} />
            Open in SQL
          </button>
          <IconButton title="Refresh table" onClick={() => setRevision((n) => n + 1)}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </IconButton>
        </div>
      </div>
      <div className="tabs">
        {['Data', 'Columns', 'Relations', 'Indexes'].map((t, i) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {
              [
                <Table2 size={15} />,
                <Columns3 size={15} />,
                <Link2 size={15} />,
                <ListTree size={15} />,
              ][i]
            }
            {t}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {tab === 'Data' ? (
        <>
          <div className="table-toolbar">
            <div className="button-group">
              <button
                className={showFilters ? 'selected' : ''}
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter size={15} />
                Filter{filters.length ? ` (${filters.length})` : ''}
              </button>
              {filters.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => {
                    setFilters([]);
                    setPage(0);
                  }}
                >
                  Clear
                </button>
              )}
              <span className="muted">
                {data ? `${data.rows.length} rows on this page` : loading ? 'Loading…' : ''}
              </span>
            </div>
            <div className="button-group">
              <button
                disabled={!data?.rows.length}
                onClick={() =>
                  exportCsv(
                    info.columns,
                    data.rows.map((r) => info.columns.map((c) => r.values[c.name])),
                    object.name,
                  )
                }
              >
                <Download size={15} />
                Export page
              </button>
              <button
                className="primary"
                disabled={!info || info.type !== 'U' || !info.canInsert || busy}
                title="Requires INSERT permission on a table"
                onClick={() => setRowForm({ action: 'insert' })}
              >
                <Plus size={16} />
                Insert row
              </button>
            </div>
          </div>
          {showFilters && (
            <div className="filter-panel">
              <div className="filter-form">
                <select
                  aria-label="Filter column"
                  value={draft.column}
                  onChange={(e) => setDraft({ ...draft, column: e.target.value })}
                >
                  {info?.columns.map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter operator"
                  value={draft.operator}
                  onChange={(e) => setDraft({ ...draft, operator: e.target.value })}
                >
                  {[
                    ['eq', 'equals'],
                    ['ne', 'does not equal'],
                    ['contains', 'contains'],
                    ['gt', 'greater than'],
                    ['gte', 'at least'],
                    ['lt', 'less than'],
                    ['lte', 'at most'],
                    ['isNull', 'is NULL'],
                    ['notNull', 'is not NULL'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Filter value"
                  disabled={['isNull', 'notNull'].includes(draft.operator)}
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  placeholder="Value"
                />
                <button
                  disabled={filters.length >= 10}
                  onClick={() => {
                    setFilters([...filters, { ...draft }]);
                    setPage(0);
                  }}
                >
                  Add filter
                </button>
              </div>
              {filters.map((f, i) => (
                <span className="filter-chip" key={i}>
                  {f.column} {f.operator} {f.value}
                  <IconButton
                    title="Remove filter"
                    onClick={() => {
                      setFilters(filters.filter((_, j) => i !== j));
                      setPage(0);
                    }}
                  >
                    <X size={12} />
                  </IconButton>
                </span>
              ))}
            </div>
          )}
          {loading ? (
            <div className="loading-view">
              <Loader2 className="spin" />
              Loading rows…
            </div>
          ) : (
            data && (
              <DataGrid
                columns={info.columns}
                rows={data.rows.map((r) => r.values)}
                sort={sort || data.sort}
                direction={direction}
                onSort={(name) => {
                  setDirection(sort === name && direction === 'ASC' ? 'DESC' : 'ASC');
                  setSort(name);
                  setPage(0);
                }}
                rowActions={
                  info.type === 'U'
                    ? (i) => (
                        <>
                          <IconButton
                            title="Edit row"
                            disabled={
                              busy ||
                              !data.rows[i].editable ||
                              !info.canUpdate ||
                              !info.columns.some((c) => c.primaryKeyOrdinal)
                            }
                            onClick={() =>
                              setRowForm({ action: 'update', row: data.rows[i].values })
                            }
                          >
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton
                            title="Delete row"
                            disabled={
                              busy ||
                              !data.rows[i].editable ||
                              !info.canDelete ||
                              !info.columns.some((c) => c.primaryKeyOrdinal)
                            }
                            onClick={() => mutation('delete', data.rows[i].values)}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </>
                      )
                    : null
                }
              />
            )
          )}
          <div className="pagination">
            <span className="muted">
              {data && !data.stableOrder
                ? 'No primary key: page order can vary.'
                : 'Rows ordered with primary key tie-breakers.'}
            </span>
            <label>
              Rows{' '}
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <IconButton
              title="Previous page"
              disabled={!page || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ArrowLeft size={16} />
            </IconButton>
            <span>Page {page + 1}</span>
            <IconButton
              title="Next page"
              disabled={!data?.hasNext || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              <ArrowRight size={16} />
            </IconButton>
          </div>
          {data?.truncated && (
            <div className="warning-bar">
              Some rows or large values exceeded the display limit. Truncated rows cannot be edited;
              use a narrower query.
            </div>
          )}
          {info && !info.columns.some((c) => c.primaryKeyOrdinal) && (
            <div className="note">
              Grid updates and deletes require a primary key. You can still use the SQL editor.
            </div>
          )}
        </>
      ) : (
        info && <Structure info={info} tab={tab} />
      )}{' '}
      {rowForm && (
        <RowForm
          key={rowForm.action}
          info={info}
          row={rowForm.row}
          action={rowForm.action}
          onClose={() => !busy && setRowForm(null)}
          onSubmit={(values) => mutation(rowForm.action, rowForm.row, values)}
          busy={busy}
          error={error}
        />
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState('connection'),
    [connection, setConnection] = useState(null),
    [checking, setChecking] = useState(false),
    [connectionError, setConnectionError] = useState(null),
    [catalog, setCatalog] = useState({ objects: [], schemas: [] }),
    [catalogError, setCatalogError] = useState(null),
    [search, setSearch] = useState(''),
    [collapsed, setCollapsed] = useState({}),
    [object, setObject] = useState(null),
    [sqlText, setSqlText] = useState(
      '-- Start with a read-only query.\nSELECT TOP (50)\n    TABLE_SCHEMA,\n    TABLE_NAME,\n    TABLE_TYPE\nFROM INFORMATION_SCHEMA.TABLES\nORDER BY TABLE_SCHEMA, TABLE_NAME;',
    ),
    [result, setResult] = useState(null),
    [resultIndex, setResultIndex] = useState(0),
    [queryError, setQueryError] = useState(null),
    [running, setRunning] = useState(false),
    [preparing, setPreparing] = useState(false),
    [queryId, setQueryId] = useState(null),
    [history, setHistory] = useState([]),
    [historyError, setHistoryError] = useState(null),
    [confirmation, setConfirmation] = useState(null),
    [notice, setNotice] = useState('');
  const resolver = useRef(),
    noticeTimer = useRef();
  const toast = (text) => {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  };
  const askConfirm = (c) =>
    new Promise((resolve) => {
      resolver.current = resolve;
      setConfirmation(c);
    });
  const resolveConfirm = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setConfirmation(null);
  };
  async function refreshCatalog() {
    try {
      setCatalogError(null);
      setCatalog(await api('/catalog'));
    } catch (e) {
      setCatalogError(e);
    }
  }
  async function checkConnection() {
    setChecking(true);
    setConnectionError(null);
    try {
      const c = await api('/connection');
      setConnection(c);
      if (c.connected) await refreshCatalog();
      else setCatalog({ objects: [], schemas: [] });
    } catch (e) {
      setConnectionError(e);
    } finally {
      setChecking(false);
    }
  }
  async function refreshHistory() {
    try {
      setHistoryError(null);
      setHistory((await api('/history')).history);
    } catch (e) {
      setHistoryError(e);
    }
  }
  useEffect(() => {
    checkConnection();
    return () => clearTimeout(noticeTimer.current);
  }, []);
  useEffect(() => {
    if (view === 'history') refreshHistory();
  }, [view]);
  async function runQuery() {
    if (running || preparing) return;
    setPreparing(true);
    setQueryError(null);
    const source = sqlText;
    try {
      const safety = await api('/query/prepare', { sql: source });
      if (safety.requiresConfirmation && !(await askConfirm({ ...safety, preview: source })))
        return;
      const id = crypto.randomUUID();
      setQueryId(id);
      setRunning(true);
      setResult(null);
      setResultIndex(0);
      const data = await api('/query/run', {
        sql: source,
        id,
        confirmationToken: safety.confirmationToken,
      });
      setResult(data);
      toast(`Query completed in ${data.elapsedMs} ms.`);
      if (safety.requiresConfirmation) refreshCatalog();
    } catch (e) {
      setQueryError(e);
    } finally {
      setRunning(false);
      setPreparing(false);
      setQueryId(null);
    }
  }
  async function cancelQuery() {
    try {
      await api('/query/cancel', { id: queryId });
      toast('Cancellation requested. Earlier statements may already have committed.');
    } catch (e) {
      setQueryError(e);
    }
  }
  const openQuery = (text) => {
    setSqlText(text);
    setView('editor');
  };
  const objects = catalog.objects.filter((o) =>
    `${o.schemaName}.${o.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const schemas = [...new Set([...catalog.schemas, ...objects.map((o) => o.schemaName)])].filter(
    (s) => !search || objects.some((o) => o.schemaName === s),
  );
  const currentResult = result?.recordsets[resultIndex];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>
            <Database size={23} />
          </span>
          <div>
            SQL Workbench<small>AZURE DATABASE TOOLS</small>
          </div>
        </div>
        <div className="workspace-label">
          <span className="workspace-avatar">L</span>
          <div>
            Local workspace<small>Single-user connection</small>
          </div>
          <ShieldCheck size={16} />
        </div>
        <nav className="main-nav" aria-label="Workspace">
          {[
            ['connection', Cable, 'Connection'],
            ['editor', Code2, 'SQL editor'],
            ['history', History, 'Query history'],
            ['team', Users, 'Project team'],
          ].map(([id, Icon, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
              <Icon size={18} />
              {label}
              {id === 'connection' && (
                <span className={'nav-dot ' + (connection?.connected ? 'online' : '')} />
              )}
            </button>
          ))}
        </nav>
        <div className="explorer-heading">
          <span>DATABASE EXPLORER</span>
          <IconButton
            title="Refresh database explorer"
            disabled={!connection?.connected}
            onClick={refreshCatalog}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search database objects"
            placeholder="Find a table or view…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="object-tree">
          {catalogError ? (
            <div className="sidebar-note error-text">{catalogError.message}</div>
          ) : !connection?.connected ? (
            <div className="sidebar-empty">
              <FolderTree size={26} />
              <p>
                Your schemas appear here
                <br />
                after you connect.
              </p>
            </div>
          ) : !objects.length ? (
            <div className="sidebar-note">
              {search ? 'No matching objects.' : 'No tables or views are visible to this account.'}
            </div>
          ) : (
            schemas.map((schema) => (
              <div key={schema}>
                <button
                  className="schema-button"
                  onClick={() => setCollapsed({ ...collapsed, [schema]: !collapsed[schema] })}
                >
                  {collapsed[schema] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <FolderTree size={14} />
                  {schema}
                  <span>{objects.filter((o) => o.schemaName === schema).length}</span>
                </button>
                {!collapsed[schema] &&
                  objects
                    .filter((o) => o.schemaName === schema)
                    .map((o) => (
                      <button
                        title={`${schema}.${o.name}`}
                        key={o.objectId}
                        className={
                          'object-button ' +
                          (view === 'explorer' && object?.objectId === o.objectId ? 'active' : '')
                        }
                        onClick={() => {
                          setObject(o);
                          setView('explorer');
                        }}
                      >
                        {o.type === 'V' ? <Eye size={14} /> : <Table2 size={14} />}
                        <span>{o.name}</span>
                      </button>
                    ))}
              </div>
            ))
          )}
        </div>
        {catalog.truncated && <div className="sidebar-note">First 10,000 objects shown.</div>}
        <div className="sidebar-bottom">
          <ShieldCheck size={17} />
          <div>
            Private by default<small>Runs on this computer</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <span>
              {view === 'explorer'
                ? `${object.schemaName}.${object.name}`
                : view === 'editor'
                  ? 'SQL editor'
                  : view === 'history'
                    ? 'Query history'
                    : view === 'team'
                      ? 'Project team'
                      : 'Connection'}
            </span>
          </div>
          <div className="topbar-status">
            <span className={'status-dot ' + (connection?.connected ? 'online' : '')} />
            {connection?.connected ? connection.database : 'No active connection'}
            <span className="local-badge">LOCAL</span>
          </div>
        </header>
        <div className="main-content">
          {view === 'team' && <Team />}
          {view === 'connection' && (
            <Connection
              connection={connection}
              checking={checking}
              onCheck={checkConnection}
              error={connectionError}
            />
          )}
          {view === 'explorer' && object && (
            <Explorer
              key={object.objectId}
              object={object}
              onQuery={openQuery}
              onChanged={refreshCatalog}
              askConfirm={askConfirm}
              toast={toast}
            />
          )}{' '}
          {view === 'editor' && (
            <div className="editor-page">
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">T-SQL WORKSPACE</span>
                  <h1>SQL editor</h1>
                  <p>Query your database. Inspect the results. Make considered changes.</p>
                </div>
                <span className="keyboard-hint">
                  <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to run
                </span>
              </div>
              <section className="editor-panel">
                <div className="editor-toolbar">
                  <span>
                    <Code2 size={15} /> query.sql <small>Transact-SQL</small>
                  </span>
                  <div className="button-group">
                    {running ? (
                      <button className="danger" onClick={cancelQuery}>
                        <Square size={14} />
                        Cancel query
                      </button>
                    ) : (
                      <button className="primary" disabled={preparing} onClick={runQuery}>
                        <Play size={15} />
                        {preparing ? 'Preparing…' : 'Run batch'}
                      </button>
                    )}
                  </div>
                </div>
                <SqlEditor value={sqlText} onChange={setSqlText} onRun={runQuery} />
                <div className="editor-foot">
                  <span>
                    <ShieldCheck size={13} /> Changes require confirmation
                  </span>
                  <span>
                    Entire batch · {connection?.limits?.maxRows || 1000} rows max ·{' '}
                    {(connection?.limits?.timeoutMs || 30000) / 1000}s timeout
                  </span>
                </div>
              </section>
              <ErrorBox error={queryError} />
              <section className="results-panel">
                <div className="results-toolbar">
                  <div className="button-group">
                    <strong>Results</strong>
                    {result && (
                      <>
                        <span className="small-badge">{result.rowCount} rows</span>
                        <span className="muted">
                          <Clock3 size={13} />
                          {result.elapsedMs} ms
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    disabled={!currentResult}
                    onClick={() => exportCsv(currentResult.columns, currentResult.rows)}
                  >
                    <Download size={15} />
                    Export CSV
                  </button>
                </div>
                {running ? (
                  <div className="loading-view">
                    <Loader2 className="spin" />
                    Executing your query…
                  </div>
                ) : !result ? (
                  <Empty
                    icon={Terminal}
                    title={queryError ? 'Query did not complete' : 'Your results will appear here'}
                  >
                    {queryError
                      ? 'Review the SQL error above. Earlier statements may have committed.'
                      : 'Run a query to see rows, column types, and execution details.'}
                  </Empty>
                ) : (
                  <>
                    {result.recordsets.length > 1 && (
                      <div className="result-tabs">
                        {result.recordsets.map((r, i) => (
                          <button
                            key={i}
                            className={resultIndex === i ? 'selected' : ''}
                            onClick={() => setResultIndex(i)}
                          >
                            Result {i + 1}
                            <span>{r.rows.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {currentResult ? (
                      <DataGrid columns={currentResult.columns} rows={currentResult.rows} />
                    ) : (
                      <Empty icon={CheckCircle2} title="Batch completed">
                        No tabular results were returned.
                      </Empty>
                    )}
                    {result.rowCounts.length > 0 && (
                      <div className="result-note">
                        Server row counts: {result.rowCounts.join(' · ')}{' '}
                        <span className="muted">
                          (includes SELECT counts when reported by SQL Server)
                        </span>
                      </div>
                    )}
                    {result.messages.map((m, i) => (
                      <pre className="sql-message" key={i}>
                        {m}
                      </pre>
                    ))}
                    {result.truncated && (
                      <div className="warning-bar">
                        Display limit reached. CSV includes displayed results only. Narrow your
                        query for a complete export.
                      </div>
                    )}
                    <div className="result-note muted">
                      Large text/binary values are limited to 32 KB by SQL Server; displayed cells
                      are limited to 16,384 characters. Decimal query results may use JavaScript
                      precision: CAST exact numeric values AS varchar when precision matters.
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
          {view === 'history' && (
            <div className="history-page">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">RECENT EXECUTIONS</span>
                  <h1>Query history</h1>
                  <p>Last 50 editor runs, held in server memory until it restarts.</p>
                </div>
                <button
                  disabled={!history.length}
                  onClick={async () => {
                    try {
                      await api('/history', undefined, 'DELETE');
                      setHistory([]);
                    } catch (e) {
                      setHistoryError(e);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  Clear history
                </button>
              </div>
              <ErrorBox error={historyError} />
              {history.length ? (
                <div className="history-list">
                  {history.map((entry) => (
                    <article className="history-item" key={entry.id}>
                      <div>
                        <span className={'history-state ' + entry.status}>
                          {entry.status === 'success' ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <AlertCircle size={16} />
                          )}{' '}
                          {entry.status === 'success' ? 'Completed' : 'Failed'}
                        </span>
                        <span className="muted">
                          {new Date(entry.startedAt).toLocaleString()} · {entry.elapsedMs} ms
                        </span>
                        <button onClick={() => openQuery(entry.sql)}>Open in editor</button>
                      </div>
                      <pre>{entry.sql}</pre>
                      {entry.error && <p className="error-text">{entry.error.message}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <section className="panel">
                  <Empty icon={History} title="No queries yet">
                    Queries you run in the SQL editor will appear here. Reopening a query never
                    executes it.
                  </Empty>
                </section>
              )}
            </div>
          )}
        </div>
        <footer className="statusbar">
          <span>
            <ShieldCheck size={13} />
            Private SQL connection string
          </span>
          <span>Azure SQL · Account permissions enforced</span>
        </footer>
      </main>
      {confirmation && (
        <Confirm
          confirmation={confirmation}
          onCancel={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
        />
      )}{' '}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
