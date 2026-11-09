/**
 * Engine-neutral schema model (design §4).
 * Elements reference each other by stable ID, never by name, so renames never break references.
 * Layout (positions) is kept separate from the schema.
 */

export type Id = string;

/** Logical (engine-neutral) data types used in Phase 1. Engine-specific types arrive in Phase 2. */
export type LogicalTypeName =
  | 'smallint' | 'integer' | 'bigint' | 'decimal' | 'real' | 'double'
  | 'boolean'
  | 'varchar' | 'char' | 'text'
  | 'date' | 'time' | 'timestamp' | 'timestamptz'
  | 'uuid' | 'json' | 'binary';

export interface DataType {
  name: LogicalTypeName;
  /** Length for varchar/char. */
  length?: number;
  /** Precision and scale for decimal. */
  precision?: number;
  scale?: number;
}

export interface DefaultValue {
  /** `literal` is quoted as needed by the DDL generator; `expression` is emitted verbatim (e.g. now()). */
  kind: 'literal' | 'expression';
  value: string;
}

export interface Column {
  id: Id;
  name: string;
  type: DataType;
  nullable: boolean;
  default?: DefaultValue;
  /** Auto-increment / identity. */
  identity?: boolean;
  comment?: string;
}

export interface PrimaryKey {
  name?: string;
  columnIds: Id[];
}

export interface Table {
  id: Id;
  name: string;
  schema?: string;
  comment?: string;
  /** Colour tag shown on the card header (one of TABLE_COLORS keys). */
  color?: TableColor;
  columns: Column[];
  primaryKey?: PrimaryKey;
}

export type RefAction = 'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default';

export interface ColumnPair {
  child: Id;
  parent: Id;
}

export interface Relationship {
  id: Id;
  name?: string;
  childTableId: Id;
  parentTableId: Id;
  columns: ColumnPair[];
  onDelete: RefAction;
  onUpdate: RefAction;
}

export interface Model {
  tables: Table[];
  relationships: Relationship[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Layout {
  positions: Record<Id, Point>;
  viewport?: Viewport;
}

export interface EngineTarget {
  /** `generic` in Phase 1 (logical types only). */
  engine: 'generic' | 'postgresql' | 'mysql' | 'sqlserver' | 'oracle' | 'sqlite';
  version?: string;
}

export interface Project {
  formatVersion: number;
  id: Id;
  name: string;
  target: EngineTarget;
  model: Model;
  layout: Layout;
}

export const TABLE_COLORS = ['sunrise', 'violet', 'blue', 'teal', 'green', 'amber', 'slate'] as const;
export type TableColor = (typeof TABLE_COLORS)[number];

export const REF_ACTIONS: { value: RefAction; label: string }[] = [
  { value: 'no_action', label: 'NO ACTION' },
  { value: 'restrict', label: 'RESTRICT' },
  { value: 'cascade', label: 'CASCADE' },
  { value: 'set_null', label: 'SET NULL' },
  { value: 'set_default', label: 'SET DEFAULT' },
];
