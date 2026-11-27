/**
 * Engine-neutral schema model (design §4).
 * Elements reference each other by stable ID, never by name, so renames never break references.
 * Layout (positions) is kept separate from the schema.
 */

export type Id = string;

/** Logical (engine-neutral) data types. Every engine type maps to one of these, which makes engine conversion deterministic (design §5.3). */
export type LogicalTypeName =
  | 'smallint' | 'integer' | 'bigint' | 'decimal' | 'real' | 'double'
  | 'boolean'
  | 'varchar' | 'char' | 'text'
  | 'date' | 'time' | 'timestamp' | 'timestamptz'
  | 'uuid' | 'json' | 'binary';

/**
 * A column's physical type in the project's target engine (e.g. `varchar(255)`, `NVARCHAR(MAX)`, `NUMBER(10,0)`).
 * For the `generic` engine the physical name is the logical name.
 */
export interface DataType {
  /** Physical type name as the engine spells it (`bigint`, `VARCHAR2`, `TIMESTAMP WITH TIME ZONE`…). */
  name: string;
  /** Length for character / binary types. */
  length?: number;
  /** `true` for SQL Server `(MAX)` lengths. */
  max?: boolean;
  /** Precision and scale for exact numerics. */
  precision?: number;
  scale?: number;
  /** Engine-neutral equivalent, kept so the model can be converted between engines. */
  logical?: LogicalTypeName;
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

export interface UniqueConstraint {
  id: Id;
  name?: string;
  columnIds: Id[];
}

export interface CheckConstraint {
  id: Id;
  name?: string;
  /** SQL boolean expression, e.g. `quantity > 0`. */
  expression: string;
}

export interface Index {
  id: Id;
  name?: string;
  columnIds: Id[];
  unique?: boolean;
}

/** Keys of the per-table constraint/index lists, used by the generic table-item commands. */
export type TableItemKind = 'uniques' | 'checks' | 'indexes';

export interface Table {
  id: Id;
  name: string;
  schema?: string;
  comment?: string;
  /** Colour tag shown on the card header (one of TABLE_COLORS keys). */
  color?: TableColor;
  columns: Column[];
  primaryKey?: PrimaryKey;
  uniques?: UniqueConstraint[];
  checks?: CheckConstraint[];
  indexes?: Index[];
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

export type EngineId = 'generic' | 'postgresql' | 'mysql' | 'sqlserver' | 'oracle' | 'sqlite';
export const ENGINE_IDS: EngineId[] = ['generic', 'postgresql', 'mysql', 'sqlserver', 'oracle', 'sqlite'];

export interface EngineTarget {
  /** `generic` uses logical types only; the others are engine dialects (Phase 2). */
  engine: EngineId;
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
