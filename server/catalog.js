import sql from 'mssql';
import { AppError, redact } from './errors.js';
import { cell } from './database.js';

export const quote = (name) => '[' + name.replaceAll(']', ']]') + ']';
export const qualified = (schema, name) => `${quote(schema)}.${quote(name)}`;
export async function catalog(pool) {
  const result = await pool.request().query(`
    SELECT TOP (10001) s.name AS schemaName, o.name, o.type, o.object_id AS objectId
    FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
    WHERE o.type IN ('U','V') AND o.is_ms_shipped=0 ORDER BY s.name,o.name;
    SELECT TOP (10001) name FROM sys.schemas WHERE name NOT IN ('sys','INFORMATION_SCHEMA') ORDER BY name;
  `);
  return {
    objects: result.recordsets[0].slice(0, 10000),
    schemas: result.recordsets[1].slice(0, 10000).map((s) => s.name),
    truncated: result.recordsets.some((r) => r.length > 10000),
  };
}
export async function objectInfo(pool, schema, name) {
  const request = pool.request().input('full', sql.NVarChar(520), qualified(schema, name));
  const result = await request.query(`
    DECLARE @id int=OBJECT_ID(@full);
    SELECT o.type, o.object_id AS objectId,
      HAS_PERMS_BY_NAME(@full,'OBJECT','INSERT') AS canInsert,
      HAS_PERMS_BY_NAME(@full,'OBJECT','UPDATE') AS canUpdate,
      HAS_PERMS_BY_NAME(@full,'OBJECT','DELETE') AS canDelete
    FROM sys.objects o WHERE o.object_id=@id AND o.type IN ('U','V');
    SELECT c.name, c.column_id AS ordinal, TYPE_NAME(c.system_type_id) AS type,
      TYPE_NAME(c.user_type_id) AS declaredType, c.max_length AS maxLength, c.precision, c.scale,
      c.is_nullable AS nullable, c.is_identity AS isIdentity, c.is_computed AS isComputed,
      c.generated_always_type AS generatedAlways, d.definition AS defaultValue,
      cc.definition AS computedDefinition,
      (SELECT TOP 1 ic.key_ordinal FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id WHERE i.object_id=@id AND i.is_primary_key=1 AND ic.column_id=c.column_id) AS primaryKeyOrdinal
    FROM sys.columns c LEFT JOIN sys.default_constraints d ON d.object_id=c.default_object_id
    LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
    WHERE c.object_id=@id ORDER BY c.column_id;
    SELECT fk.name, pc.name AS columnName, rs.name AS referencedSchema, ro.name AS referencedTable,
      rc.name AS referencedColumn, fk.delete_referential_action_desc AS onDelete,
      fk.update_referential_action_desc AS onUpdate, fkc.constraint_column_id AS ordinal
    FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
    JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id
    JOIN sys.objects ro ON ro.object_id=fkc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=ro.schema_id
    JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id
    WHERE fk.parent_object_id=@id ORDER BY fk.name,fkc.constraint_column_id;
    SELECT i.name, i.type_desc AS type, i.is_unique AS isUnique, i.is_primary_key AS isPrimary,
      i.filter_definition AS filter, c.name AS columnName, ic.key_ordinal AS ordinal,
      ic.is_descending_key AS descending, ic.is_included_column AS included
    FROM sys.indexes i LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE i.object_id=@id AND i.index_id>0 ORDER BY i.index_id,ic.key_ordinal,ic.index_column_id;
  `);
  if (!result.recordsets[0][0])
    throw new AppError(
      'This object does not exist or its metadata is not visible to this account.',
      'permission',
      404,
    );
  return {
    schema,
    name,
    ...result.recordsets[0][0],
    columns: result.recordsets[1],
    foreignKeys: result.recordsets[2],
    indexes: result.recordsets[3],
  };
}

const supported = new Set([
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
]);
export const writable = (c) =>
  supported.has(c.type) && !c.isIdentity && !c.isComputed && !c.generatedAlways;
export const comparable = (c) =>
  supported.has(c.type) && !['text', 'ntext', 'image', 'xml'].includes(c.type);
export function typeSql(c) {
  if (!supported.has(c.type)) throw new AppError('Use the SQL editor for this column type.');
  if (['varchar', 'char', 'binary', 'varbinary', 'nvarchar', 'nchar'].includes(c.type))
    return `${c.type}(${c.maxLength === -1 ? 'max' : c.type.startsWith('n') ? c.maxLength / 2 : c.maxLength})`;
  if (['decimal', 'numeric'].includes(c.type)) return `${c.type}(${c.precision},${c.scale})`;
  if (['datetime2', 'datetimeoffset', 'time'].includes(c.type)) return `${c.type}(${c.scale})`;
  return c.type;
}
function parameter(request, key, value, c) {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    throw new AppError('Column values must be text, numbers, booleans or null.');
  if (typeof value === 'string' && value.length > 16384)
    throw new AppError('Use the SQL editor for values longer than 16,384 characters.');
  const str =
    value == null ? null : typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  request.input(key, sql.NVarChar(sql.MAX), str);
  if (['binary', 'varbinary', 'image'].includes(c.type)) return `CONVERT(${typeSql(c)},@${key},1)`;
  return `CAST(@${key} AS ${typeSql(c)})`;
}

// Convert precise numbers, dates and binary values to strings before the JS driver
// can round them. Preserve original values for safe key and concurrency predicates.
export function projection(c) {
  const q = quote(c.name);
  if (['money', 'smallmoney'].includes(c.type)) return `CONVERT(nvarchar(100),${q},2) AS ${q}`;
  if (['bigint', 'decimal', 'numeric'].includes(c.type))
    return `CONVERT(nvarchar(100),${q}) AS ${q}`;
  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset', 'time'].includes(c.type))
    return `CONVERT(nvarchar(100),${q},127) AS ${q}`;
  if (['binary', 'varbinary', 'image', 'timestamp', 'rowversion'].includes(c.type))
    return `CONVERT(varchar(max),${q},1) AS ${q}`;
  if (['xml', 'text', 'ntext', 'hierarchyid'].includes(c.type))
    return `CONVERT(nvarchar(max),${q}) AS ${q}`;
  if (['geometry', 'geography'].includes(c.type)) return `${q}.ToString() AS ${q}`;
  return q;
}
export async function tableData(pool, input) {
  const info = await objectInfo(pool, input.schema, input.name);
  await pool.request().query('SET TEXTSIZE 65536;');
  const req = pool.request();
  const byName = new Map(info.columns.map((c) => [c.name, c]));
  const conditions = input.filters.map((filter, i) => {
    const c = byName.get(filter.column);
    if (!c || !comparable(c))
      throw new AppError(
        'Select a filterable column. XML, text and spatial values should be queried in SQL.',
      );
    const q = quote(c.name);
    if (filter.operator === 'isNull') return `${q} IS NULL`;
    if (filter.operator === 'notNull') return `${q} IS NOT NULL`;
    if (filter.operator === 'contains') {
      req.input(
        `filter${i}`,
        sql.NVarChar(16384),
        '%' + String(filter.value ?? '').replace(/[~%_\[]/g, '~$&') + '%',
      );
      return `CONVERT(nvarchar(max),${q}) LIKE @filter${i} ESCAPE '~'`;
    }
    const operators = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    return `${q} ${operators[filter.operator]} ${parameter(req, `filter${i}`, filter.value, c)}`;
  });
  const keys = info.columns
    .filter((c) => c.primaryKeyOrdinal)
    .sort((a, b) => a.primaryKeyOrdinal - b.primaryKeyOrdinal);
  const sort = input.sort ? byName.get(input.sort) : keys[0] || info.columns.find(comparable);
  if (input.sort && (!sort || !comparable(sort)))
    throw new AppError('This column cannot be sorted here. Use the SQL editor.');
  const order = sort
    ? [sort, ...keys.filter((c) => c.name !== sort.name)]
        .map((c) => `${quote(c.name)} ${c === sort ? input.direction : 'ASC'}`)
        .join(',')
    : '(SELECT NULL)';
  req
    .input('offset', sql.Int, input.page * input.pageSize)
    .input('size', sql.Int, input.pageSize + 1);
  const query = `SELECT ${info.columns.map(projection).join(',')} FROM ${qualified(input.schema, input.name)} ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY ${order} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;`;
  // Page size is small; stream to bound cells and total bytes as well.
  const result = await new Promise((resolve, reject) => {
    const rows = [];
    let error,
      bytes = 0,
      truncated = false,
      received = 0;
    req.stream = true;
    let timer = setTimeout(() => {
      error = new AppError(
        'Table read timed out. Narrow the filter or sort using an indexed column.',
        'timeout',
        408,
      );
      req.cancel();
    }, 30000);
    req.on('row', (row) => {
      received++;
      if (received > input.pageSize) return;
      const rowTruncated = Object.values(row).some(
        (v) =>
          (typeof v === 'string' && v.length > 16384) || (Buffer.isBuffer(v) && v.length > 8192),
      );
      const safe = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)]));
      bytes += Buffer.byteLength(JSON.stringify(safe));
      if (bytes > 2 * 1024 * 1024) {
        truncated = true;
        return;
      }
      const redacted = redact(safe);
      rows.push({
        values: redacted,
        editable: !rowTruncated && JSON.stringify(redacted) === JSON.stringify(safe),
      });
      truncated ||= rowTruncated;
    });
    req.on('error', (e) => {
      error ??= e;
    });
    req.on('done', () => {
      clearTimeout(timer);
      error ? reject(error) : resolve({ rows, hasNext: received > input.pageSize, truncated });
    });
    req.query(query).catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return {
    ...result,
    stableOrder: keys.length > 0,
    page: input.page,
    pageSize: input.pageSize,
    sort: sort?.name,
    info,
  };
}

export async function mutate(pool, input) {
  const info = await objectInfo(pool, input.schema, input.name);
  if (info.type !== 'U')
    throw new AppError('Grid editing is available for tables. Use SQL for updatable views.');
  const keys = info.columns.filter((c) => c.primaryKeyOrdinal);
  if (input.action !== 'insert' && !keys.length)
    throw new AppError(
      'A primary key is required for safe grid edits. Use an explicit SQL statement for this table.',
    );
  const req = pool.request();
  const columns = new Map(info.columns.map((c) => [c.name, c]));
  let i = 0;
  const assignments = Object.entries(input.values).map(([name, value]) => {
    const c = columns.get(name);
    if (!c || !writable(c))
      throw new AppError('One or more columns cannot be edited. Refresh the table metadata.');
    return { name: quote(name), param: parameter(req, `value${i++}`, value, c) };
  });
  const target = qualified(input.schema, input.name);
  let statement;
  if (input.action === 'insert')
    statement = assignments.length
      ? `INSERT INTO ${target} (${assignments.map((a) => a.name).join(',')}) VALUES (${assignments.map((a) => a.param).join(',')});`
      : `INSERT INTO ${target} DEFAULT VALUES;`;
  else {
    if (!input.original || keys.some((c) => !Object.hasOwn(input.original, c.name)))
      throw new AppError('Original primary key values are required. Refresh the row.');
    const concurrency = info.columns.filter(
      (c) => comparable(c) && Object.hasOwn(input.original, c.name),
    );
    if (keys.some((c) => !comparable(c)))
      throw new AppError('This primary key type requires an explicit SQL statement.');
    const where = concurrency.map((c) =>
      input.original[c.name] === null
        ? `${quote(c.name)} IS NULL`
        : `${quote(c.name)}=${parameter(req, `original${i++}`, input.original[c.name], c)}`,
    );
    const version = info.columns.find((c) => ['timestamp', 'rowversion'].includes(c.type));
    if (version && Object.hasOwn(input.original, version.name)) {
      req.input('version', sql.VarChar(100), input.original[version.name]);
      where.push(`${quote(version.name)}=CONVERT(varbinary(8),@version,1)`);
    }
    if (input.action === 'update' && !assignments.length)
      throw new AppError('Select at least one column to update.');
    statement =
      input.action === 'delete'
        ? `DELETE FROM ${target} WHERE ${where.join(' AND ')};`
        : `UPDATE ${target} SET ${assignments.map((a) => a.name + '=' + a.param).join(',')} WHERE ${where.join(' AND ')};`;
  }
  if (i > 1800) throw new AppError('This row has too many values for the grid editor. Use SQL.');
  const result = await req.query(
    `SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION; ${statement} DECLARE @changed int=@@ROWCOUNT; IF @changed<>1 THROW 50001,'The row changed, was removed, or is no longer visible. Refresh before trying again.',1; COMMIT TRANSACTION; SELECT @changed AS affected; END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION; THROW; END CATCH;`,
  );
  return { affectedRows: result.recordsets.at(-1)[0].affected };
}
