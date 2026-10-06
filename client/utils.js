export function csv(columns, rows) {
  const escape = (value) => {
    let text =
      value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Prevent spreadsheet applications from interpreting data as formulas.
    if (/^[\s\uFEFF]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      columns.map((c) => escape(c.name)).join(','),
      ...rows.map((row) => row.map(escape).join(',')),
    ].join('\r\n')
  );
}
export function exportCsv(columns, rows, name = 'query-results') {
  const url = URL.createObjectURL(
    new Blob([csv(columns, rows)], { type: 'text/csv;charset=utf-8;' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const display = (value) =>
  value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
export const typeLabel = (c) =>
  ['nvarchar', 'varchar', 'nchar', 'char', 'binary', 'varbinary'].includes(c.type)
    ? `${c.type}(${c.maxLength === -1 ? 'max' : c.type.startsWith('n') ? c.maxLength / 2 : c.maxLength})`
    : ['decimal', 'numeric'].includes(c.type)
      ? `${c.type}(${c.precision},${c.scale})`
      : c.type;
