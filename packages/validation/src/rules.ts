import {
  formatType, makeColumn, makeIndex, makeUnique, uniqueName,
  type Column, type Command, type DataType, type Id, type Relationship, type Table, type TableItemKind,
} from '@erd/model';
import { findType, isIntegerType, refActionLabel, typeDefaults, versionAtLeast, type Dialect } from '@erd/dialects';
import type { Issue, IssueTarget, ModelRule, QuickFix, RelationshipRule, Rule, RuleContext, Severity, TableRule } from './types';

/* ------------------------------------------------------------------ helpers */

function issue(ruleId: string, severity: Severity, target: IssueTarget, message: string, explanation: string, fixes: QuickFix[] = []): Issue {
  const key = [ruleId, target.tableId, target.columnId, target.relationshipId, target.itemId, target.field].filter(Boolean).join(':');
  return { key, ruleId, severity, target, message, explanation, fixes };
}

const utf8 = new TextEncoder();
const nameLength = (d: Dialect, name: string) => (d.identifiers.unit === 'bytes' ? utf8.encode(name).length : [...name].length);
const UNQUOTED = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function hash6(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6);
}
/** Shortens a name to fit the engine limit, keeping it unique with a stable hash suffix. */
export function shortenName(name: string, max: number): string {
  let base = name;
  while (utf8.encode(base).length > max - 7) base = base.slice(0, -1);
  return `${base}_${hash6(name)}`;
}
const snake = (s: string) => s.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'unnamed';

type NamedThing =
  | { kind: 'table'; table: Table }
  | { kind: 'column'; table: Table; column: Column }
  | { kind: 'item'; table: Table; itemKind: TableItemKind; itemId: Id; name: string };

const renameCommand = (t: NamedThing, name: string): Command =>
  t.kind === 'table' ? { type: 'updateTable', tableId: t.table.id, patch: { name } }
    : t.kind === 'column' ? { type: 'updateColumn', tableId: t.table.id, columnId: t.column.id, patch: { name } }
      : { type: 'updateTableItem', tableId: t.table.id, kind: t.itemKind, itemId: t.itemId, patch: { name } };

const targetOf = (t: NamedThing): IssueTarget =>
  t.kind === 'table' ? { kind: 'table', tableId: t.table.id, field: 'name' }
    : t.kind === 'column' ? { kind: 'column', tableId: t.table.id, columnId: t.column.id, field: 'name' }
      : { kind: 'item', tableId: t.table.id, itemKind: t.itemKind, itemId: t.itemId, field: 'name' };

const labelOf = (t: NamedThing) => (t.kind === 'table' ? `Table ${t.table.name || '(unnamed)'}` : t.kind === 'column' ? `${t.table.name}.${t.column.name || '(unnamed)'}` : `${t.table.name}: ${t.name}`);

/** Name checks shared by tables, columns and named constraints: E-NAM-001/003/004, W-NAM-005. */
function nameIssues(ctx: RuleContext, thing: NamedThing, name: string, siblings: string[]): Issue[] {
  const { dialect: d, engineLabel } = ctx;
  const out: Issue[] = [];
  const target = targetOf(thing);
  if (!name.trim()) {
    const base = thing.kind === 'table' ? 'table' : thing.kind === 'column' ? 'column' : 'constraint';
    return [issue('E-NAM-001', 'error', target, `${labelOf(thing)}: name is empty`, 'Every table, column and named constraint needs a name to be created.',
      [{ label: `Name it ${uniqueName(base, siblings)}`, commands: [renameCommand(thing, uniqueName(base, siblings))] }])];
  }
  const max = d.identifiers.maxLength;
  if (max && nameLength(d, name) > max) {
    const short = shortenName(name, max);
    out.push(issue('E-NAM-003', 'error', target, `${labelOf(thing)}: name is ${nameLength(d, name)} ${d.identifiers.unit === 'bytes' ? 'bytes' : 'characters'}; ${engineLabel} allows ${max}`,
      d.id === 'postgresql' ? 'PostgreSQL silently truncates longer identifiers, which can make two names collide.' : `${d.displayName} rejects identifiers longer than ${max} ${d.identifiers.unit}.`,
      [{ label: `Shorten to ${short}`, commands: [renameCommand(thing, short)] }]));
  }
  if (d.identifiers.reservedWords.has(name.toLowerCase())) {
    const alt = uniqueName(thing.kind === 'table' ? `${name}s` : `${name}_value`, siblings);
    const altOk = !d.identifiers.reservedWords.has(alt.toLowerCase()) ? alt : uniqueName(`${name}_1`, siblings);
    out.push(issue('E-NAM-004', 'warning', target, `${labelOf(thing)}: "${name}" is a reserved word in ${engineLabel}`,
      'Reserved words only work as identifiers when quoted everywhere they are used, which is easy to get wrong in queries.',
      [{ label: `Rename to ${altOk}`, commands: [renameCommand(thing, altOk)] }]));
  }
  if (!UNQUOTED.test(name)) {
    const s = uniqueName(snake(name), siblings);
    out.push(issue('W-NAM-005', 'warning', target, `${labelOf(thing)}: "${name}" contains spaces or special characters`,
      'Names like this must be quoted in every query.', s !== name ? [{ label: `Rename to ${s}`, commands: [renameCommand(thing, s)] }] : []));
  } else if ((d.identifiers.caseFolding === 'lower' && name !== name.toLowerCase()) || (d.identifiers.caseFolding === 'upper' && name !== name.toLowerCase() && name !== name.toUpperCase())) {
    const s = uniqueName(snake(name), siblings);
    out.push(issue('W-NAM-005', 'warning', target, `${labelOf(thing)}: mixed-case name "${name}"`,
      `${d.displayName} folds unquoted names to ${d.identifiers.caseFolding} case, so this name must be quoted everywhere to keep its spelling.`,
      [{ label: `Rename to ${s}`, commands: [renameCommand(thing, s)] }]));
  }
  return out;
}

const colTarget = (t: Table, c: Column, field: IssueTarget['field']): IssueTarget => ({ kind: 'column', tableId: t.id, columnId: c.id, field });
const setType = (t: Table, c: Column, type: DataType): Command => ({ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { type } });

/* ------------------------------------------------------------------ table rules */

const tableNames: TableRule = {
  id: 'names', scope: 'table',
  check(ctx, t) {
    const out = nameIssues(ctx, { kind: 'table', table: t }, t.name, ctx.project.model.tables.filter((x) => x.id !== t.id).map((x) => x.name));
    const seen = new Map<string, Column>();
    for (const c of t.columns) {
      const others = t.columns.filter((x) => x.id !== c.id).map((x) => x.name);
      out.push(...nameIssues(ctx, { kind: 'column', table: t, column: c }, c.name, others));
      const k = c.name.trim().toLowerCase();
      if (k && seen.has(k)) {
        const n = uniqueName(c.name, others);
        out.push(issue('E-NAM-002', 'error', colTarget(t, c, 'name'), `${t.name}.${c.name}: duplicate column name`, 'Column names must be unique within a table (names are compared case-insensitively).', [{ label: `Rename to ${n}`, commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { name: n } }] }]));
      } else if (k) seen.set(k, c);
    }
    for (const kind of ['uniques', 'checks', 'indexes'] as const) {
      for (const item of t[kind] ?? []) if (item.name) out.push(...nameIssues(ctx, { kind: 'item', table: t, itemKind: kind, itemId: item.id, name: item.name }, item.name, []));
    }
    if (t.schema && !ctx.dialect.capabilities.schemas) {
      out.push(issue('W-SCH-001', 'warning', { kind: 'table', tableId: t.id, field: 'schema' }, `${t.name}: ${ctx.dialect.displayName} has no schemas inside a database`,
        ctx.dialect.id === 'mysql' ? 'In MySQL a schema is a separate database; the table will be created in the current database.' : 'The schema name will be ignored.',
        [{ label: 'Clear schema', commands: [{ type: 'updateTable', tableId: t.id, patch: { schema: undefined } }] }]));
    }
    return out;
  },
};

const tableShape: TableRule = {
  id: 'table-shape', scope: 'table',
  check(ctx, t) {
    const { idType } = typeDefaults(ctx.dialect, ctx.version);
    if (!t.columns.length) {
      const col = makeColumn('id', idType, { nullable: false, identity: true });
      return [issue('W-TBL-001', 'warning', { kind: 'table', tableId: t.id }, `${t.name}: table has no columns`, 'Most engines cannot create a table without columns.',
        [{ label: 'Add id primary key', commands: [{ type: 'addColumn', tableId: t.id, column: col }, { type: 'setPrimaryKey', tableId: t.id, columnIds: [col.id] }] }])];
    }
    if (!t.primaryKey?.columnIds.length) {
      const existing = t.columns.find((c) => c.name.toLowerCase() === 'id');
      const col = makeColumn(uniqueName('id', t.columns.map((c) => c.name)), idType, { nullable: false, identity: true });
      return [issue('W-PK-002', 'warning', { kind: 'table', tableId: t.id, field: 'primaryKey' }, `${t.name}: table has no primary key`,
        'Without a primary key, rows cannot be reliably identified, updated or referenced by foreign keys.',
        existing ? [{ label: `Make ${existing.name} the primary key`, commands: [{ type: 'setPrimaryKey', tableId: t.id, columnIds: [existing.id] }] }]
          : [{ label: `Add ${col.name} primary key`, commands: [{ type: 'addColumn', tableId: t.id, column: col, index: 0 }, { type: 'setPrimaryKey', tableId: t.id, columnIds: [col.id] }] }])];
    }
    return [];
  },
};

const LITERAL_CHECKS: Partial<Record<string, { test: (v: string) => boolean; what: string }>> = {
  integer: { test: (v) => /^[-+]?\d+$/.test(v), what: 'a whole number' },
  number: { test: (v) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v), what: 'a number' },
  boolean: { test: (v) => /^(true|false|t|f|yes|no|y|n|1|0)$/i.test(v), what: 'true or false' },
  date: { test: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v), what: 'a date like 2026-01-31' },
  uuid: { test: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), what: 'a UUID' },
};

const columnTypes: TableRule = {
  id: 'column-types', scope: 'table',
  check(ctx, t) {
    const { dialect: d, version, engineLabel } = ctx;
    const out: Issue[] = [];
    const pk = new Set(t.primaryKey?.columnIds ?? []);
    const identities = t.columns.filter((c) => c.identity);
    for (const c of t.columns) {
      const where = `${t.name}.${c.name}`;
      const desc = findType(d, c.type.name);
      const logical = d.toLogical(c.type);
      // E-TYP-001: type exists in this engine and version.
      if (!desc || !versionAtLeast(d, version, desc.minVersion)) {
        const m = d.mapLogical(c.type.logical ?? logical, c.type, version);
        out.push(issue('E-TYP-001', 'error', colTarget(t, c, 'type'), `${where}: type ${formatType(c.type)} is not supported by ${engineLabel}`,
          desc ? `${desc.name} needs ${d.displayName} ${desc.minVersion} or later.` : `${engineLabel} has no type called ${c.type.name}.`,
          [{ label: `Use ${formatType(m.type)}`, commands: [setType(t, c, m.type)] }]));
      } else {
        // E-TYP-002: parameters.
        const fix = (label: string, type: DataType) => [{ label, commands: [setType(t, c, type)] }];
        if (desc.length) {
          const L = desc.length;
          if (c.type.max && !L.allowMax) out.push(issue('E-TYP-002', 'error', colTarget(t, c, 'length'), `${where}: ${desc.name} does not accept MAX`, `The maximum length of ${desc.name} is ${L.max}.`, fix(`Use ${desc.name}(${L.max})`, { ...c.type, max: undefined, length: L.max })));
          else if (!c.type.max && c.type.length == null && L.required) out.push(issue('E-TYP-002', 'error', colTarget(t, c, 'length'), `${where}: ${desc.name} needs a length in ${engineLabel}`,
            d.id === 'sqlserver' ? `Without a length, SQL Server creates ${desc.name}(1) in column definitions.` : `${engineLabel} rejects ${desc.name} without a length.`, fix(`Set length ${L.default ?? 255}`, { ...c.type, length: L.default ?? 255 })));
          else if (c.type.length != null && (c.type.length < L.min || c.type.length > L.max)) {
            const v = Math.min(Math.max(c.type.length, L.min), L.max);
            out.push(issue('E-TYP-002', 'error', colTarget(t, c, 'length'), `${where}: length ${c.type.length} is outside ${L.min}–${L.max} for ${desc.name}`, `${engineLabel} rejects lengths outside this range.`,
              L.allowMax && c.type.length > L.max ? fix(`Use ${desc.name}(MAX)`, { ...c.type, length: undefined, max: true }) : fix(`Set length ${v}`, { ...c.type, length: v })));
          }
        }
        if (desc.precision && c.type.precision != null) {
          const P = desc.precision, S = desc.scale;
          if (c.type.precision < P.min || c.type.precision > P.max) {
            const v = Math.min(Math.max(c.type.precision, P.min), P.max);
            out.push(issue('E-TYP-002', 'error', colTarget(t, c, 'precision'), `${where}: precision ${c.type.precision} is outside ${P.min}–${P.max} for ${desc.name}`, `${engineLabel} rejects this precision.`, fix(`Set precision ${v}`, { ...c.type, precision: v, scale: Math.min(c.type.scale ?? 0, v) })));
          } else if (c.type.scale != null && (c.type.scale > c.type.precision || (S && (c.type.scale < S.min || c.type.scale > S.max)))) {
            const v = Math.max(Math.min(c.type.scale, c.type.precision, S?.max ?? Infinity), S?.min ?? 0);
            out.push(issue('E-TYP-002', 'error', colTarget(t, c, 'precision'), `${where}: scale ${c.type.scale} must be between ${S?.min ?? 0} and the precision (${c.type.precision})`, 'The scale is the number of digits after the decimal point, so it cannot exceed the precision.', fix(`Set scale ${v}`, { ...c.type, scale: v })));
          }
        }
        // E-DEF-002: MySQL literal defaults on TEXT/BLOB/JSON.
        if (c.default?.kind === 'literal' && desc.noLiteralDefault) {
          out.push(issue('E-DEF-002', 'error', colTarget(t, c, 'default'), `${where}: ${engineLabel} does not allow a literal default on ${desc.name}`,
            'MySQL only accepts an expression default, written in parentheses, for TEXT, BLOB and JSON columns (8.0.13 and later).',
            [{ label: `Use expression ('${c.default.value}')`, commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { default: { kind: 'expression', value: `('${c.default.value.replace(/'/g, "''")}')` } } }] },
              { label: 'Remove default', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { default: undefined } }] }]));
        }
      }
      // E-DEF-001: literal default must suit the type.
      if (c.default?.kind === 'literal') {
        const kind = ['smallint', 'integer', 'bigint'].includes(logical) ? 'integer' : ['decimal', 'real', 'double'].includes(logical) ? 'number' : logical === 'boolean' ? 'boolean' : logical === 'date' ? 'date' : logical === 'uuid' ? 'uuid' : undefined;
        const chk = kind ? LITERAL_CHECKS[kind] : undefined;
        if (chk && !chk.test(c.default.value.trim())) {
          out.push(issue('E-DEF-001', 'error', colTarget(t, c, 'default'), `${where}: default '${c.default.value}' is not ${chk.what}`, `A ${formatType(c.type)} column cannot store this value, so CREATE TABLE fails.`,
            [{ label: 'Remove default', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { default: undefined } }] },
              ...(/\(/.test(c.default.value) ? [{ label: 'Treat as expression', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { default: { kind: 'expression', value: c.default.value } } } as Command] }] : [])]));
        }
      }
      // E-PK-001: primary-key columns are NOT NULL.
      if (pk.has(c.id) && c.nullable) {
        out.push(issue('E-PK-001', 'error', colTarget(t, c, 'nullable'), `${where}: primary-key column is nullable`, 'Primary-key columns can never contain NULL.', [{ label: 'Set NOT NULL', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { nullable: false } }] }]));
      }
      // E-IDN-001: identity needs an integer type.
      if (c.identity && !isIntegerType(d, c.type)) {
        const bigint = d.mapLogical('bigint', undefined, version).type;
        out.push(issue('E-IDN-001', 'error', colTarget(t, c, 'identity'), `${where}: auto-increment needs an integer type, not ${formatType(c.type)}`, `${d.capabilities.identitySyntax} only works on integer columns.`,
          [{ label: `Change type to ${formatType(bigint)}`, commands: [setType(t, c, bigint)] }, { label: 'Turn off auto-increment', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { identity: undefined } }] }]));
      }
    }
    // E-IDN-002: one identity per table.
    if (d.capabilities.singleIdentity && identities.length > 1) {
      const keep = identities.find((c) => pk.has(c.id)) ?? identities[0]!;
      for (const c of identities) if (c !== keep) {
        out.push(issue('E-IDN-002', 'error', colTarget(t, c, 'identity'), `${t.name}.${c.name}: ${engineLabel} allows only one auto-increment column per table`, `${t.name} already has ${keep.name} as its auto-increment column.`,
          [{ label: 'Turn off auto-increment', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { identity: undefined } }] }]));
      }
    }
    // E-IDN-003: MySQL AUTO_INCREMENT must lead a key.
    if (d.capabilities.identityMustBeKey) {
      for (const c of identities) {
        const leads = (ids: Id[] | undefined) => ids?.[0] === c.id;
        if (!leads(t.primaryKey?.columnIds) && !(t.uniques ?? []).some((u) => leads(u.columnIds)) && !(t.indexes ?? []).some((i) => leads(i.columnIds))) {
          out.push(issue('E-IDN-003', 'error', colTarget(t, c, 'identity'), `${t.name}.${c.name}: AUTO_INCREMENT column must be the first column of a key`, 'MySQL rejects the table with "there can be only one auto column and it must be defined as a key".',
            [{ label: 'Add an index on it', commands: [{ type: 'addTableItem', tableId: t.id, kind: 'indexes', item: makeIndex([c.id]) }] }]));
        }
      }
    }
    // E-IDN-004: SQLite AUTOINCREMENT only as INTEGER PRIMARY KEY.
    if (d.capabilities.identityRowidOnly) {
      for (const c of identities) {
        const ok = t.primaryKey?.columnIds.length === 1 && t.primaryKey.columnIds[0] === c.id && c.type.name.toUpperCase() === 'INTEGER';
        if (!ok) out.push(issue('E-IDN-004', 'error', colTarget(t, c, 'identity'), `${t.name}.${c.name}: SQLite AUTOINCREMENT only works on a single INTEGER PRIMARY KEY`, 'SQLite auto-increment is tied to the rowid, which only an INTEGER PRIMARY KEY column can alias.',
          [{ label: 'Turn off auto-increment', commands: [{ type: 'updateColumn', tableId: t.id, columnId: c.id, patch: { identity: undefined } }] },
            ...(t.primaryKey?.columnIds.length !== 1 || t.primaryKey.columnIds[0] !== c.id ? [] : [{ label: 'Change type to INTEGER', commands: [setType(t, c, { name: 'INTEGER', logical: 'bigint' })] }])]));
      }
    }
    return out;
  },
};

const tableItems: TableRule = {
  id: 'table-items', scope: 'table',
  check(ctx, t) {
    const out: Issue[] = [];
    const key = (ids: Id[]) => [...ids].sort().join(',');
    const pkKey = t.primaryKey ? key(t.primaryKey.columnIds) : null;
    const colName = (id: Id) => t.columns.find((c) => c.id === id)?.name ?? '?';
    const seenU = new Set<string>();
    for (const u of t.uniques ?? []) {
      const k = key(u.columnIds);
      if (k === pkKey || seenU.has(k)) {
        out.push(issue('W-CON-002', 'warning', { kind: 'item', tableId: t.id, itemKind: 'uniques', itemId: u.id, field: 'columns' }, `${t.name}: unique constraint on (${u.columnIds.map(colName).join(', ')}) duplicates ${k === pkKey ? 'the primary key' : 'another unique constraint'}`,
          'It adds a redundant index and slows down writes.', [{ label: 'Remove it', commands: [{ type: 'removeTableItem', tableId: t.id, kind: 'uniques', itemId: u.id }] }]));
      }
      seenU.add(k);
    }
    for (const k of t.checks ?? []) {
      if (!k.expression.trim()) out.push(issue('E-CHK-001', 'error', { kind: 'item', tableId: t.id, itemKind: 'checks', itemId: k.id, field: 'expression' }, `${t.name}: check constraint has no expression`, 'A CHECK constraint needs a condition such as quantity > 0.',
        [{ label: 'Remove it', commands: [{ type: 'removeTableItem', tableId: t.id, kind: 'checks', itemId: k.id }] }]));
      else if (!balanced(k.expression)) out.push(issue('E-CHK-002', 'error', { kind: 'item', tableId: t.id, itemKind: 'checks', itemId: k.id, field: 'expression' }, `${t.name}: check expression has unbalanced parentheses or quotes`, 'The CREATE TABLE statement would not parse.'));
    }
    const seenI = new Map<string, Id>();
    for (const i of t.indexes ?? []) {
      const ordered = i.columnIds.join(',');
      if (seenI.has(ordered) || (pkKey && t.primaryKey!.columnIds.join(',') === ordered)) {
        out.push(issue('W-IDX-002', 'warning', { kind: 'item', tableId: t.id, itemKind: 'indexes', itemId: i.id, field: 'columns' }, `${t.name}: index on (${i.columnIds.map(colName).join(', ')}) duplicates ${seenI.has(ordered) ? 'another index' : 'the primary key'}`,
          'Duplicate indexes use space and slow down writes without speeding up reads.', [{ label: 'Remove it', commands: [{ type: 'removeTableItem', tableId: t.id, kind: 'indexes', itemId: i.id }] }]));
      }
      seenI.set(ordered, i.id);
    }
    return out;
  },
};

function balanced(s: string): boolean {
  let depth = 0, quote: string | null = null;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0 && !quote;
}

/* ------------------------------------------------------------------ relationship rules */

const TYPE_FAMILY: Record<string, string> = { smallint: 'int', integer: 'int', bigint: 'int', decimal: 'num', real: 'num', double: 'num', boolean: 'bool', varchar: 'str', char: 'str', text: 'str', date: 'date', time: 'time', timestamp: 'ts', timestamptz: 'ts', uuid: 'uuid', json: 'json', binary: 'bin' };

const relationshipRules: RelationshipRule = {
  id: 'relationships', scope: 'relationship',
  check(ctx, r) {
    const { dialect: d, engineLabel } = ctx;
    const child = ctx.tableById.get(r.childTableId), parent = ctx.tableById.get(r.parentTableId);
    if (!child || !parent) return [];
    const out: Issue[] = [];
    const target = (field?: IssueTarget['field']): IssueTarget => ({ kind: 'relationship', relationshipId: r.id, tableId: child.id, ...(field ? { field } : {}) });
    const label = `${child.name} → ${parent.name}`;
    const pairs = r.columns.map((p) => ({ c: child.columns.find((x) => x.id === p.child)!, p: parent.columns.find((x) => x.id === p.parent)! })).filter((x) => x.c && x.p);

    // E-FK-003: referenced columns are the PK or a unique constraint.
    const refKey = r.columns.map((p) => p.parent).sort().join(',');
    const keys = [parent.primaryKey?.columnIds, ...(parent.uniques ?? []).map((u) => u.columnIds), ...(parent.indexes ?? []).filter((i) => i.unique).map((i) => i.columnIds)].filter(Boolean).map((ids) => [...ids!].sort().join(','));
    if (!keys.includes(refKey)) {
      const cols = pairs.map((x) => x.p.name).join(', ');
      out.push(issue('E-FK-003', 'error', target('columns'), `${label}: ${parent.name}(${cols}) is not a primary key or unique constraint`,
        'A foreign key can only reference columns that are guaranteed unique, so each child row matches exactly one parent row.',
        [{ label: `Add unique constraint on ${parent.name}(${cols})`, commands: [{ type: 'addTableItem', tableId: parent.id, kind: 'uniques', item: makeUnique(r.columns.map((p) => p.parent)) }] }]));
    }
    // E-FK-002: compatible types.
    for (const { c, p } of pairs) {
      const cl = d.toLogical(c.type), pl = d.toLogical(p.type);
      const same = formatType(c.type).toLowerCase() === formatType(p.type).toLowerCase();
      if (same) continue;
      const sameFamily = TYPE_FAMILY[cl] === TYPE_FAMILY[pl];
      const strict = d.id === 'mysql'; // InnoDB requires integer types of the same size
      const severity: Severity = !sameFamily || strict ? 'error' : 'warning';
      out.push(issue('E-FK-002', severity, { ...target('columns'), columnId: c.id }, `${child.name}.${c.name} (${formatType(c.type)}) does not match ${parent.name}.${p.name} (${formatType(p.type)})`,
        sameFamily ? (strict ? 'MySQL requires a foreign key and the column it references to have the same type and size.' : 'Mismatched sizes force conversions on every join and can reject valid parent values.') : `${engineLabel} cannot compare these types, so the foreign key cannot be created.`,
        [{ label: `Change ${c.name} to ${formatType(p.type)}`, commands: [setType(child, c, structuredClone(p.type))] }]));
    }
    // W-FK-004: SET NULL on NOT NULL columns.
    for (const field of ['onDelete', 'onUpdate'] as const) {
      if (r[field] === 'set_null') {
        const nn = pairs.filter((x) => !x.c.nullable);
        if (nn.length) out.push(issue('W-FK-004', 'warning', target(field), `${label}: ${field === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'} SET NULL but ${nn.map((x) => x.c.name).join(', ')} ${nn.length > 1 ? 'are' : 'is'} NOT NULL`,
          'The action would fail at run time because the column cannot be set to NULL.',
          [{ label: `Make ${nn.map((x) => x.c.name).join(', ')} nullable`, commands: nn.map((x): Command => ({ type: 'updateColumn', tableId: child.id, columnId: x.c.id, patch: { nullable: true } })) },
            { label: 'Use NO ACTION', commands: [{ type: 'updateRelationship', relationshipId: r.id, patch: { [field]: 'no_action' } }] }]));
      }
      // E-FK-005: action supported by the engine.
      const allowed = field === 'onDelete' ? d.capabilities.onDelete : d.capabilities.onUpdate;
      if (!allowed.includes(r[field])) {
        out.push(issue('E-FK-005', 'error', target(field), `${label}: ${engineLabel} does not support ${field === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'} ${refActionLabel(r[field])}`,
          `Supported: ${allowed.map(refActionLabel).join(', ')}.`, [{ label: 'Use NO ACTION', commands: [{ type: 'updateRelationship', relationshipId: r.id, patch: { [field]: 'no_action' } }] }]));
      }
    }
    // I-IDX-001: supporting index for the FK columns (MySQL creates one automatically).
    if (d.id !== 'mysql') {
      const fk = r.columns.map((p) => p.child);
      const leads = (ids: Id[] | undefined) => !!ids && fk.every((id, i) => ids[i] === id);
      if (!leads(child.primaryKey?.columnIds) && !(child.uniques ?? []).some((u) => leads(u.columnIds)) && !(child.indexes ?? []).some((i) => leads(i.columnIds))) {
        out.push(issue('I-IDX-001', 'info', target('columns'), `${child.name}(${pairs.map((x) => x.c.name).join(', ')}) has a foreign key but no supporting index`,
          `${engineLabel} does not index foreign-key columns automatically; joins and deletes on ${parent.name} will scan ${child.name}.`,
          [{ label: 'Add index', commands: [{ type: 'addTableItem', tableId: child.id, kind: 'indexes', item: makeIndex(fk) }] }]));
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ model rules */

const duplicateTables: ModelRule = {
  id: 'duplicate-tables', scope: 'model',
  check(ctx) {
    const out: Issue[] = [];
    const seen = new Map<string, Table>();
    const all = ctx.project.model.tables;
    for (const t of all) {
      const k = `${(t.schema ?? '').toLowerCase()}.${t.name.trim().toLowerCase()}`;
      if (!t.name.trim()) continue;
      if (seen.has(k)) {
        const n = uniqueName(t.name, all.filter((x) => x.id !== t.id).map((x) => x.name));
        out.push(issue('E-NAM-002', 'error', { kind: 'table', tableId: t.id, field: 'name' }, `Duplicate table name "${t.name}"`, 'Table names must be unique within a schema (compared case-insensitively).', [{ label: `Rename to ${n}`, commands: [{ type: 'updateTable', tableId: t.id, patch: { name: n } }] }]));
      } else seen.set(k, t);
    }
    // E-NAM-006: explicitly named constraints and indexes must be unique per schema.
    const names = new Map<string, number>();
    const add = (n?: string) => { if (n) names.set(n.toLowerCase(), (names.get(n.toLowerCase()) ?? 0) + 1); };
    for (const t of all) { add(t.primaryKey?.name); for (const k of ['uniques', 'checks', 'indexes'] as const) for (const i of t[k] ?? []) add(i.name); }
    for (const r of ctx.project.model.relationships) add(r.name);
    for (const t of all) for (const k of ['uniques', 'checks', 'indexes'] as const) for (const i of t[k] ?? []) {
      if (i.name && names.get(i.name.toLowerCase())! > 1) out.push(issue('E-NAM-006', 'error', { kind: 'item', tableId: t.id, itemKind: k, itemId: i.id, field: 'name' }, `${t.name}: constraint name "${i.name}" is used more than once`, 'Constraint and index names must be unique within a schema.',
        [{ label: 'Clear the name (use a generated one)', commands: [{ type: 'updateTableItem', tableId: t.id, kind: k, itemId: i.id, patch: { name: undefined } }] }]));
    }
    for (const r of ctx.project.model.relationships) if (r.name && names.get(r.name.toLowerCase())! > 1) {
      out.push(issue('E-NAM-006', 'error', { kind: 'relationship', relationshipId: r.id, tableId: r.childTableId, field: 'name' }, `Relationship name "${r.name}" is used more than once`, 'Constraint names must be unique within a schema.',
        [{ label: 'Clear the name (use a generated one)', commands: [{ type: 'updateRelationship', relationshipId: r.id, patch: { name: undefined } }] }]));
    }
    return out;
  },
};

const cycles: ModelRule = {
  id: 'cycles', scope: 'model',
  check(ctx) {
    // Tarjan SCC over child → parent edges, ignoring self-references.
    const edges = new Map<Id, Id[]>();
    for (const r of ctx.project.model.relationships) if (r.childTableId !== r.parentTableId) edges.set(r.childTableId, [...(edges.get(r.childTableId) ?? []), r.parentTableId]);
    let idx = 0;
    const index = new Map<Id, number>(), low = new Map<Id, number>(), onStack = new Set<Id>(), stack: Id[] = [];
    const sccs: Id[][] = [];
    const visit = (v: Id) => {
      index.set(v, idx); low.set(v, idx); idx++; stack.push(v); onStack.add(v);
      for (const w of edges.get(v) ?? []) {
        if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
      if (low.get(v) === index.get(v)) {
        const comp: Id[] = [];
        let w: Id;
        do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1) sccs.push(comp);
      }
    };
    for (const t of ctx.project.model.tables) if (!index.has(t.id)) visit(t.id);
    return sccs.map((comp) => {
      const names = comp.map((id) => ctx.tableById.get(id)?.name ?? '?').sort();
      return issue('I-REL-001', 'info', { kind: 'table', tableId: comp.sort()[0] }, `Circular foreign keys between ${names.join(', ')}`,
        'This is valid, but the tables must be created first and the foreign keys added afterwards, and inserts need deferred constraints or nullable keys.');
    });
  },
};

export const RULES: Rule[] = [tableNames, tableShape, columnTypes, tableItems, relationshipRules, duplicateTables, cycles];

/** Rule catalogue for documentation and the UI (id → title). */
export const RULE_CATALOGUE: Record<string, string> = {
  'E-NAM-001': 'Name is empty',
  'E-NAM-002': 'Duplicate table or column name',
  'E-NAM-003': 'Identifier longer than the engine allows',
  'E-NAM-004': 'Reserved word used as a name',
  'W-NAM-005': 'Name needs quoting (special characters or case)',
  'E-NAM-006': 'Duplicate constraint name',
  'W-SCH-001': 'Engine has no schemas',
  'W-TBL-001': 'Table has no columns',
  'W-PK-002': 'Table has no primary key',
  'E-TYP-001': 'Type not supported by the engine or version',
  'E-TYP-002': 'Type parameter missing or out of range',
  'E-DEF-001': 'Default value does not suit the type',
  'E-DEF-002': 'Literal default not allowed for the type',
  'E-PK-001': 'Primary-key column is nullable',
  'E-IDN-001': 'Auto-increment on a non-integer column',
  'E-IDN-002': 'More than one auto-increment column',
  'E-IDN-003': 'MySQL AUTO_INCREMENT column is not a key',
  'E-IDN-004': 'SQLite AUTOINCREMENT not on INTEGER PRIMARY KEY',
  'W-CON-002': 'Duplicate unique constraint',
  'E-CHK-001': 'Check constraint without expression',
  'E-CHK-002': 'Check expression does not parse',
  'W-IDX-002': 'Duplicate index',
  'E-FK-002': 'Foreign-key type mismatch',
  'E-FK-003': 'Foreign key does not reference a key',
  'W-FK-004': 'SET NULL on a NOT NULL column',
  'E-FK-005': 'Referential action not supported',
  'I-IDX-001': 'Foreign key without supporting index',
  'I-REL-001': 'Circular foreign keys',
};
