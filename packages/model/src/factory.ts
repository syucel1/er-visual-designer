import { defaultDataType, sameType, formatType } from './logicalTypes';
import { newId } from './ids';
import { fkColumnName, uniqueName } from './naming';
import type { Command } from './commands';
import type { Column, Id, LogicalTypeName, Point, Project, Relationship, Table } from './types';

/* ---------------- Element factories ---------------- */

export function makeColumn(name: string, type: LogicalTypeName = 'varchar', extra: Partial<Column> = {}): Column {
  return { id: newId('c'), name, type: defaultDataType(type), nullable: true, ...extra };
}

/** A new table with an `id bigint` identity primary key. */
export function makeTable(project: Project, name?: string): Table {
  const idCol = makeColumn('id', 'bigint', { nullable: false, identity: true });
  return {
    id: newId('t'),
    name: name ?? uniqueName('table', project.model.tables.map((t) => t.name)),
    columns: [idCol],
    primaryKey: { columnIds: [idCol.id] },
  };
}

/* ---------------- Higher-level operations (return commands) ---------------- */

export function addTableCommand(project: Project, position: Point, name?: string): { command: Command; table: Table } {
  const table = makeTable(project, name);
  return { command: { type: 'addTable', table, position }, table };
}

export function addColumnCommand(project: Project, tableId: Id, index?: number): { command: Command; column: Column } {
  const t = mustTable(project, tableId);
  const column = makeColumn(uniqueName('column', t.columns.map((c) => c.name)), 'varchar');
  return { command: { type: 'addColumn', tableId, column, index }, column };
}

/** Copies a table (new IDs, name_copy) next to the original. Relationships are not copied. */
export function duplicateTableCommand(project: Project, tableId: Id): { command: Command; table: Table } {
  const src = mustTable(project, tableId);
  const idMap = new Map<Id, Id>();
  const columns = src.columns.map((c) => { const id = newId('c'); idMap.set(c.id, id); return { ...structuredClone(c), id }; });
  const table: Table = {
    ...structuredClone(src),
    id: newId('t'),
    name: uniqueName(`${src.name}_copy`, project.model.tables.map((t) => t.name)),
    columns,
    primaryKey: src.primaryKey ? { ...src.primaryKey, name: undefined, columnIds: src.primaryKey.columnIds.map((id) => idMap.get(id)!) } : undefined,
  };
  if (!table.primaryKey) delete table.primaryKey;
  if (table.primaryKey && table.primaryKey.name === undefined) delete table.primaryKey.name;
  const pos = project.layout.positions[tableId] ?? { x: 0, y: 0 };
  return { command: { type: 'addTable', table, position: { x: pos.x + 40, y: pos.y + 40 } }, table };
}

export function togglePrimaryKeyCommand(project: Project, tableId: Id, columnId: Id): Command {
  const t = mustTable(project, tableId);
  const pk = t.primaryKey?.columnIds ?? [];
  const next = pk.includes(columnId) ? pk.filter((id) => id !== columnId) : [...pk, columnId];
  return { type: 'setPrimaryKey', tableId, columnIds: next };
}

/* ---------------- Connecting columns (FK by drag) ---------------- */

export interface Endpoint {
  tableId: Id;
  /** Omitted when the user dropped on the table itself rather than on a column. */
  columnId?: Id;
}

export type ConnectionPlan =
  | { kind: 'ok'; command: Command; relationship: Relationship; message: string }
  | { kind: 'confirm'; title: string; message: string; primary: { label: string; command: Command }; secondary?: { label: string; command: Command }; relationship: Relationship }
  | { kind: 'error'; message: string };

const isPk = (t: Table, colId: Id) => !!t.primaryKey?.columnIds.includes(colId);

/**
 * Works out what a drag from one column to another column (or table) means (roadmap Phase 1):
 * - column → column: the side whose column is a primary key is the parent; the other side holds the FK.
 *   If types differ the user is asked whether to change the FK column's type.
 * - PK column → another table: creates matching FK column(s) in that table (all PK columns if composite).
 * - non-key column → another table: links the column to that table's primary key.
 */
export function planConnection(project: Project, from: Endpoint, to: Endpoint): ConnectionPlan {
  if (!from.columnId) return { kind: 'error', message: 'Start the link from a column.' };
  const a = mustTable(project, from.tableId);
  const b = mustTable(project, to.tableId);
  const aCol = a.columns.find((c) => c.id === from.columnId);
  if (!aCol) return { kind: 'error', message: 'Column not found.' };

  if (to.columnId) {
    const bCol = b.columns.find((c) => c.id === to.columnId);
    if (!bCol) return { kind: 'error', message: 'Column not found.' };
    if (aCol.id === bCol.id) return { kind: 'error', message: 'A column cannot reference itself.' };
    // Decide direction: the PK side is the parent.
    let child = { t: a, c: aCol }, parent = { t: b, c: bCol };
    if (!isPk(b, bCol.id) && isPk(a, aCol.id)) { child = { t: b, c: bCol }; parent = { t: a, c: aCol }; }
    const rel = newRelationship(child.t.id, parent.t.id, [{ child: child.c.id, parent: parent.c.id }]);
    const dup = findDuplicate(project, rel);
    if (dup) return { kind: 'error', message: 'That relationship already exists.' };
    const create: Command = { type: 'createRelationship', relationship: rel };
    const linkMsg = `Linked ${child.t.name}.${child.c.name} → ${parent.t.name}.${parent.c.name}`;
    if (!sameType(child.c.type, parent.c.type)) {
      return {
        kind: 'confirm',
        title: 'Column types differ',
        message: `${child.t.name}.${child.c.name} is ${formatType(child.c.type)} but ${parent.t.name}.${parent.c.name} is ${formatType(parent.c.type)}. A foreign key should have the same type as the column it references.`,
        primary: { label: `Change ${child.c.name} to ${formatType(parent.c.type)} and link`, command: { type: 'batch', label: 'Create relationship', commands: [{ type: 'updateColumn', tableId: child.t.id, columnId: child.c.id, patch: { type: structuredClone(parent.c.type) } }, create] } },
        secondary: { label: 'Link without changing the type', command: create },
        relationship: rel,
      };
    }
    return { kind: 'ok', command: create, relationship: rel, message: linkMsg };
  }

  // Dropped on a table (not a column).
  if (isPk(a, aCol.id)) {
    // a is the parent: create FK column(s) in b for every PK column of a.
    const pkCols = a.primaryKey!.columnIds.map((id) => a.columns.find((c) => c.id === id)!).filter(Boolean);
    const selfRef = a.id === b.id;
    const names: string[] = b.columns.map((c) => c.name);
    const newCols: Column[] = pkCols.map((pc) => {
      const name = fkColumnName(a, pc.name, { ...b, columns: names.map((n) => ({ name: n }) as Column) });
      names.push(name);
      return makeColumn(name, pc.type.name, { type: structuredClone(pc.type), nullable: selfRef });
    });
    const rel = newRelationship(b.id, a.id, newCols.map((nc, i) => ({ child: nc.id, parent: pkCols[i]!.id })));
    const command: Command = { type: 'batch', label: 'Create relationship', commands: [...newCols.map((column) => ({ type: 'addColumn', tableId: b.id, column }) as Command), { type: 'createRelationship', relationship: rel }] };
    return { kind: 'ok', command, relationship: rel, message: `Added ${newCols.map((c) => `${b.name}.${c.name}`).join(', ')} → ${a.name}` };
  }
  // a holds the FK: link to b's primary key.
  const bPk = b.primaryKey?.columnIds ?? [];
  if (bPk.length !== 1) return { kind: 'error', message: bPk.length ? `${b.name} has a composite primary key — drop onto a specific column instead.` : `${b.name} has no primary key to reference.` };
  return planConnection(project, from, { tableId: b.id, columnId: bPk[0] });
}

export function newRelationship(childTableId: Id, parentTableId: Id, columns: { child: Id; parent: Id }[]): Relationship {
  return { id: newId('r'), childTableId, parentTableId, columns, onDelete: 'no_action', onUpdate: 'no_action' };
}

function findDuplicate(project: Project, rel: Relationship) {
  const key = (r: Relationship) => r.columns.map((p) => `${p.child}>${p.parent}`).join(',');
  return project.model.relationships.find((r) => key(r) === key(rel));
}

/** Cardinality used by the canvas markers. */
export function cardinality(project: Project, rel: Relationship): { childOptional: boolean; oneToOne: boolean } {
  const child = project.model.tables.find((t) => t.id === rel.childTableId);
  if (!child) return { childOptional: false, oneToOne: false };
  const cols = rel.columns.map((p) => child.columns.find((c) => c.id === p.child)).filter(Boolean) as Column[];
  const childOptional = cols.some((c) => c.nullable);
  const pk = child.primaryKey?.columnIds ?? [];
  const oneToOne = pk.length === cols.length && cols.every((c) => pk.includes(c.id));
  return { childOptional, oneToOne };
}

export function mustTable(project: Project, id: Id): Table {
  const t = project.model.tables.find((x) => x.id === id);
  if (!t) throw new Error(`Table ${id} not found`);
  return t;
}
