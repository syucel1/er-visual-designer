import { produceWithPatches, enablePatches, type Draft, type Patch } from 'immer';
import type { Column, Id, Point, Project, Relationship, Table } from './types';

enablePatches();

/**
 * Every change to a project is a serialisable command (design §7).
 * Commands are applied with Immer; the forward/inverse patches it produces are what the
 * history stores, so every command is undoable without hand-written inverse logic.
 */
export type Command =
  | { type: 'renameProject'; name: string }
  | { type: 'addTable'; table: Table; position: Point }
  | { type: 'removeTables'; tableIds: Id[] }
  | { type: 'updateTable'; tableId: Id; patch: Partial<Pick<Table, 'name' | 'schema' | 'comment' | 'color'>> }
  | { type: 'addColumn'; tableId: Id; column: Column; index?: number }
  | { type: 'updateColumn'; tableId: Id; columnId: Id; patch: Partial<Omit<Column, 'id'>> }
  | { type: 'removeColumn'; tableId: Id; columnId: Id }
  | { type: 'moveColumn'; tableId: Id; columnId: Id; toIndex: number }
  | { type: 'setPrimaryKey'; tableId: Id; columnIds: Id[] }
  | { type: 'createRelationship'; relationship: Relationship }
  | { type: 'updateRelationship'; relationshipId: Id; patch: Partial<Pick<Relationship, 'name' | 'onDelete' | 'onUpdate' | 'columns'>> }
  | { type: 'removeRelationships'; relationshipIds: Id[] }
  | { type: 'moveTables'; moves: { tableId: Id; to: Point }[] }
  | { type: 'batch'; label: string; commands: Command[] };

export class CommandError extends Error {
  override name = 'CommandError';
}

export interface ExecResult {
  project: Project;
  patches: Patch[];
  inversePatches: Patch[];
}

/** Applies a command and returns the next immutable project plus forward and inverse patches. */
export function execute(project: Project, command: Command): ExecResult {
  const [next, patches, inversePatches] = produceWithPatches(project, (draft) => {
    apply(draft, command);
  });
  return { project: next, patches, inversePatches };
}

/** Human-readable label for history and toasts. */
export function describe(command: Command, project?: Project): string {
  const tname = (id: Id) => project?.model.tables.find((t) => t.id === id)?.name ?? 'table';
  switch (command.type) {
    case 'renameProject': return 'Rename project';
    case 'addTable': return `Add table ${command.table.name}`;
    case 'removeTables': return command.tableIds.length === 1 ? `Delete table ${tname(command.tableIds[0]!)}` : `Delete ${command.tableIds.length} tables`;
    case 'updateTable': return `Edit table ${tname(command.tableId)}`;
    case 'addColumn': return `Add column ${command.column.name}`;
    case 'updateColumn': return 'Edit column';
    case 'removeColumn': return 'Delete column';
    case 'moveColumn': return 'Reorder column';
    case 'setPrimaryKey': return `Change primary key of ${tname(command.tableId)}`;
    case 'createRelationship': return 'Create relationship';
    case 'updateRelationship': return 'Edit relationship';
    case 'removeRelationships': return command.relationshipIds.length === 1 ? 'Delete relationship' : `Delete ${command.relationshipIds.length} relationships`;
    case 'moveTables': return command.moves.length === 1 ? 'Move table' : `Move ${command.moves.length} tables`;
    case 'batch': return command.label;
  }
}

/* ------------------------------------------------------------------ */

type D = Draft<Project>;

function table(d: D, id: Id): Draft<Table> {
  const t = d.model.tables.find((x) => x.id === id);
  if (!t) throw new CommandError(`Table ${id} does not exist`);
  return t;
}

function column(t: Draft<Table>, id: Id): Draft<Column> {
  const c = t.columns.find((x) => x.id === id);
  if (!c) throw new CommandError(`Column ${id} does not exist in table ${t.name}`);
  return c;
}

function checkRelationship(d: D, r: Relationship, ignoreId?: Id) {
  const child = table(d, r.childTableId);
  const parent = table(d, r.parentTableId);
  if (!r.columns.length) throw new CommandError('A relationship needs at least one column pair');
  for (const pair of r.columns) {
    column(child, pair.child);
    column(parent, pair.parent);
    if (pair.child === pair.parent) throw new CommandError('A column cannot reference itself');
  }
  const childCols = r.columns.map((p) => p.child).join(',');
  const parentCols = r.columns.map((p) => p.parent).join(',');
  const dup = d.model.relationships.find((x) => x.id !== ignoreId && x.columns.map((p) => p.child).join(',') === childCols && x.columns.map((p) => p.parent).join(',') === parentCols);
  if (dup) throw new CommandError('That relationship already exists');
}

function apply(d: D, c: Command): void {
  switch (c.type) {
    case 'renameProject':
      d.name = c.name;
      return;

    case 'addTable': {
      if (d.model.tables.some((t) => t.id === c.table.id)) throw new CommandError(`Table id ${c.table.id} already exists`);
      d.model.tables.push(structuredClone(c.table));
      d.layout.positions[c.table.id] = { ...c.position };
      return;
    }

    case 'removeTables': {
      const ids = new Set(c.tableIds);
      for (const id of ids) table(d, id);
      d.model.tables = d.model.tables.filter((t) => !ids.has(t.id));
      d.model.relationships = d.model.relationships.filter((r) => !ids.has(r.childTableId) && !ids.has(r.parentTableId));
      for (const id of ids) delete d.layout.positions[id];
      return;
    }

    case 'updateTable':
      Object.assign(table(d, c.tableId), c.patch);
      return;

    case 'addColumn': {
      const t = table(d, c.tableId);
      if (t.columns.some((x) => x.id === c.column.id)) throw new CommandError(`Column id ${c.column.id} already exists`);
      const i = c.index == null ? t.columns.length : Math.max(0, Math.min(c.index, t.columns.length));
      t.columns.splice(i, 0, structuredClone(c.column));
      return;
    }

    case 'updateColumn': {
      const col = column(table(d, c.tableId), c.columnId);
      for (const [k, v] of Object.entries(c.patch)) {
        if (v === undefined) delete (col as Record<string, unknown>)[k];
        else (col as Record<string, unknown>)[k] = structuredClone(v);
      }
      return;
    }

    case 'removeColumn': {
      const t = table(d, c.tableId);
      column(t, c.columnId);
      t.columns = t.columns.filter((x) => x.id !== c.columnId);
      if (t.primaryKey) {
        t.primaryKey.columnIds = t.primaryKey.columnIds.filter((id) => id !== c.columnId);
        if (!t.primaryKey.columnIds.length) delete t.primaryKey;
      }
      // Drop the column from any relationship; relationships left without pairs are removed.
      for (const r of d.model.relationships) r.columns = r.columns.filter((p) => p.child !== c.columnId && p.parent !== c.columnId);
      d.model.relationships = d.model.relationships.filter((r) => r.columns.length > 0);
      return;
    }

    case 'moveColumn': {
      const t = table(d, c.tableId);
      const from = t.columns.findIndex((x) => x.id === c.columnId);
      if (from < 0) throw new CommandError(`Column ${c.columnId} does not exist`);
      const to = Math.max(0, Math.min(c.toIndex, t.columns.length - 1));
      const [col] = t.columns.splice(from, 1);
      t.columns.splice(to, 0, col!);
      return;
    }

    case 'setPrimaryKey': {
      const t = table(d, c.tableId);
      for (const id of c.columnIds) column(t, id).nullable = false; // PK implies NOT NULL
      if (c.columnIds.length) t.primaryKey = { ...(t.primaryKey?.name ? { name: t.primaryKey.name } : {}), columnIds: [...c.columnIds] };
      else delete t.primaryKey;
      return;
    }

    case 'createRelationship': {
      if (d.model.relationships.some((r) => r.id === c.relationship.id)) throw new CommandError(`Relationship id ${c.relationship.id} already exists`);
      checkRelationship(d, c.relationship);
      d.model.relationships.push(structuredClone(c.relationship));
      return;
    }

    case 'updateRelationship': {
      const r = d.model.relationships.find((x) => x.id === c.relationshipId);
      if (!r) throw new CommandError(`Relationship ${c.relationshipId} does not exist`);
      const next = { ...(JSON.parse(JSON.stringify(r)) as Relationship), ...c.patch };
      checkRelationship(d, next, r.id);
      for (const [k, v] of Object.entries(c.patch)) {
        if (v === undefined) delete (r as Record<string, unknown>)[k];
        else (r as Record<string, unknown>)[k] = structuredClone(v);
      }
      return;
    }

    case 'removeRelationships': {
      const ids = new Set(c.relationshipIds);
      d.model.relationships = d.model.relationships.filter((r) => !ids.has(r.id));
      return;
    }

    case 'moveTables':
      for (const m of c.moves) {
        table(d, m.tableId);
        d.layout.positions[m.tableId] = { x: Math.round(m.to.x), y: Math.round(m.to.y) };
      }
      return;

    case 'batch':
      for (const sub of c.commands) apply(d, sub);
      return;
  }
}
