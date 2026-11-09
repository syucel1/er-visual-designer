import { isLogicalType } from './logicalTypes';
import { newId } from './ids';
import type { Column, Project, Relationship, Table } from './types';
import { TABLE_COLORS } from './types';

/** Current `.erd.json` format version. Bump it together with a migration in MIGRATIONS. */
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.erd.json';

export class ProjectFormatError extends Error {
  override name = 'ProjectFormatError';
}

export function createEmptyProject(name = 'untitled_schema'): Project {
  return {
    formatVersion: FORMAT_VERSION,
    id: newId('p'),
    name,
    target: { engine: 'generic' },
    model: { tables: [], relationships: [] },
    layout: { positions: {} },
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2) + '\n';
}

/**
 * Migrations from older format versions. MIGRATIONS[n] upgrades a version-n object to n+1.
 * Version 1 is the first released format, so there are none yet; the mechanism is in place for Phase 2+.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export interface ParseResult {
  project: Project;
  /** Non-fatal problems that were repaired while loading (e.g. dangling references). */
  warnings: string[];
}

/** Parses and validates a project file (JSON text or object), migrating it to the current format. */
export function parseProject(input: string | unknown): ParseResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input); } catch (e) { throw new ProjectFormatError(`Not valid JSON: ${(e as Error).message}`); }
  }
  if (!isObj(raw)) throw new ProjectFormatError('The file does not contain a project object.');
  let obj = raw as Record<string, unknown>;
  let version = typeof obj.formatVersion === 'number' ? obj.formatVersion : NaN;
  if (!Number.isInteger(version) || version < 1) throw new ProjectFormatError('Missing or invalid "formatVersion".');
  if (version > FORMAT_VERSION) throw new ProjectFormatError(`This file was saved by a newer version (format ${version}); this app reads up to format ${FORMAT_VERSION}.`);
  while (version < FORMAT_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) throw new ProjectFormatError(`No migration from format ${version}.`);
    obj = m(obj);
    version++;
  }
  return validate(obj);
}

function validate(o: Record<string, unknown>): ParseResult {
  const warnings: string[] = [];
  const fail = (msg: string): never => { throw new ProjectFormatError(msg); };
  const model = isObj(o.model) ? o.model : fail('Missing "model".');
  const rawTables = Array.isArray(model.tables) ? model.tables : fail('"model.tables" must be an array.');
  const rawRels = Array.isArray(model.relationships) ? model.relationships : [];

  const tableIds = new Set<string>();
  const columnOwner = new Map<string, string>();
  const tables: Table[] = rawTables.map((t: unknown, i: number) => {
    if (!isObj(t)) fail(`Table #${i + 1} is not an object.`);
    const tt = t as Record<string, unknown>;
    const id = str(tt.id) || fail(`Table #${i + 1} has no id.`);
    if (tableIds.has(id)) fail(`Duplicate table id ${id}.`);
    tableIds.add(id);
    const name = typeof tt.name === 'string' ? tt.name : fail(`Table ${id} has no name.`);
    const cols = Array.isArray(tt.columns) ? tt.columns : fail(`Table ${name} has no columns array.`);
    const columns: Column[] = cols.map((c: unknown, j: number) => {
      if (!isObj(c)) fail(`Column #${j + 1} of ${name} is not an object.`);
      const cc = c as Record<string, unknown>;
      const cid = str(cc.id) || fail(`Column #${j + 1} of ${name} has no id.`);
      if (columnOwner.has(cid)) fail(`Duplicate column id ${cid}.`);
      columnOwner.set(cid, id);
      const type = isObj(cc.type) ? cc.type : fail(`Column ${name}.${String(cc.name)} has no type.`);
      const typeName = type.name;
      if (!isLogicalType(typeName)) return fail(`Column ${name}.${String(cc.name)} has unknown type "${String(typeName)}".`);
      const col: Column = {
        id: cid,
        name: typeof cc.name === 'string' ? cc.name : fail(`Column ${cid} has no name.`),
        type: { name: typeName, ...num('length', type.length), ...num('precision', type.precision), ...num('scale', type.scale) },
        nullable: cc.nullable !== false,
      };
      if (isObj(cc.default) && typeof cc.default.value === 'string') col.default = { kind: cc.default.kind === 'expression' ? 'expression' : 'literal', value: cc.default.value };
      if (cc.identity === true) col.identity = true;
      if (typeof cc.comment === 'string' && cc.comment) col.comment = cc.comment;
      return col;
    });
    // Build in a fixed key order so saving a loaded file does not reorder it.
    const table: Table = {
      id, name,
      ...(typeof tt.schema === 'string' && tt.schema ? { schema: tt.schema } : {}),
      ...(typeof tt.comment === 'string' && tt.comment ? { comment: tt.comment } : {}),
      ...(typeof tt.color === 'string' && (TABLE_COLORS as readonly string[]).includes(tt.color) ? { color: tt.color as Table['color'] } : {}),
      columns,
    };
    if (isObj(tt.primaryKey) && Array.isArray(tt.primaryKey.columnIds)) {
      const ids = (tt.primaryKey.columnIds as unknown[]).filter((x): x is string => typeof x === 'string');
      const valid = ids.filter((x) => columns.some((c) => c.id === x));
      if (valid.length !== ids.length) warnings.push(`${name}: removed ${ids.length - valid.length} unknown primary-key column reference(s).`);
      if (valid.length) {
        table.primaryKey = { columnIds: valid, ...(typeof tt.primaryKey.name === 'string' && tt.primaryKey.name ? { name: tt.primaryKey.name } : {}) };
        for (const c of columns) if (valid.includes(c.id)) c.nullable = false;
      }
    }
    return table;
  });

  const relIds = new Set<string>();
  const relationships: Relationship[] = [];
  rawRels.forEach((r: unknown, i: number) => {
    if (!isObj(r)) { warnings.push(`Relationship #${i + 1} ignored (not an object).`); return; }
    const rr = r as Record<string, unknown>;
    const id = str(rr.id);
    const child = str(rr.childTableId), parent = str(rr.parentTableId);
    if (!id || relIds.has(id) || !tableIds.has(child) || !tableIds.has(parent) || !Array.isArray(rr.columns)) { warnings.push(`Relationship ${id || '#' + (i + 1)} ignored (invalid or dangling reference).`); return; }
    const pairs = (rr.columns as unknown[]).filter(isObj).map((p) => ({ child: str(p.child), parent: str(p.parent) }))
      .filter((p) => columnOwner.get(p.child) === child && columnOwner.get(p.parent) === parent);
    if (!pairs.length) { warnings.push(`Relationship ${id} ignored (its columns no longer exist).`); return; }
    relIds.add(id);
    const action = (v: unknown) => (['no_action', 'restrict', 'cascade', 'set_null', 'set_default'].includes(v as string) ? v : 'no_action') as Relationship['onDelete'];
    relationships.push({ id, childTableId: child, parentTableId: parent, columns: pairs, onDelete: action(rr.onDelete), onUpdate: action(rr.onUpdate), ...(typeof rr.name === 'string' && rr.name ? { name: rr.name } : {}) });
  });

  const layoutRaw = isObj(o.layout) ? o.layout : {};
  const posRaw = isObj(layoutRaw.positions) ? layoutRaw.positions : {};
  const positions: Project['layout']['positions'] = {};
  tables.forEach((t, i) => {
    const p = posRaw[t.id];
    if (isObj(p) && typeof p.x === 'number' && typeof p.y === 'number') positions[t.id] = { x: p.x, y: p.y };
    else { positions[t.id] = { x: 40 + (i % 4) * 300, y: 40 + Math.floor(i / 4) * 260 }; warnings.push(`${t.name}: no position saved, placed automatically.`); }
  });
  const vp = layoutRaw.viewport;
  const project: Project = {
    formatVersion: FORMAT_VERSION,
    id: str(o.id) || newId('p'),
    name: typeof o.name === 'string' && o.name ? o.name : 'untitled_schema',
    target: { engine: 'generic' },
    model: { tables, relationships },
    layout: { positions, ...(isObj(vp) && typeof vp.x === 'number' && typeof vp.y === 'number' && typeof vp.zoom === 'number' ? { viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } } : {}) },
  };
  return { project, warnings };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num<K extends string>(k: K, v: unknown): Partial<Record<K, number>> {
  return typeof v === 'number' && Number.isFinite(v) ? ({ [k]: v } as Record<K, number>) : {};
}
