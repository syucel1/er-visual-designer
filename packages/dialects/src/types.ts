import type { DataType, EngineId, LogicalTypeName, RefAction } from '@erd/model';

/** Allowed range for a type parameter. */
export interface ParamSpec {
  min: number;
  max: number;
  /** Value filled in when the type is chosen. */
  default?: number;
  /** The engine rejects (or silently misreads) the type without this parameter. */
  required?: boolean;
  /** Accepts the keyword MAX instead of a number (SQL Server). */
  allowMax?: boolean;
}

export type TypeCategory = 'Numeric' | 'Boolean' | 'Text' | 'Date & time' | 'Binary' | 'Other';

/** One physical type of an engine, as offered by the type picker (design §5.1). */
export interface TypeDescriptor {
  /** Canonical spelling, e.g. `varchar`, `NVARCHAR`, `TIMESTAMP WITH TIME ZONE`. */
  name: string;
  category: TypeCategory;
  /** Logical equivalent used for conversion between engines. */
  logical: LogicalTypeName;
  /** Character/binary length parameter. */
  length?: ParamSpec;
  /** Exact-numeric precision and scale. Scale max is also capped at the precision. */
  precision?: ParamSpec;
  scale?: ParamSpec;
  /** Other spellings that resolve to this type (e.g. int4 → integer). */
  aliases?: string[];
  /** First engine version that supports the type. */
  minVersion?: string;
  /** Literal DEFAULT values are not allowed (MySQL TEXT / BLOB / JSON). */
  noLiteralDefault?: boolean;
  /** Short hint shown in the picker. */
  note?: string;
}

export interface IdentifierRules {
  /** Maximum identifier length, or null when the engine has no practical limit. */
  maxLength: number | null;
  /** Whether the limit counts bytes (UTF-8) or characters. */
  unit: 'bytes' | 'chars';
  /** How unquoted identifiers are folded: PostgreSQL → lower, Oracle → upper. */
  caseFolding: 'lower' | 'upper' | 'none';
  quote: (name: string) => string;
  reservedWords: ReadonlySet<string>;
}

export interface Capabilities {
  /** Auto-increment syntax, for display: GENERATED … AS IDENTITY, AUTO_INCREMENT, IDENTITY(1,1)… */
  identitySyntax: string;
  /** At most one identity / auto-increment column per table. */
  singleIdentity: boolean;
  /** The auto-increment column must be (the first column of) a key — MySQL. */
  identityMustBeKey: boolean;
  /** Auto-increment only as INTEGER PRIMARY KEY — SQLite. */
  identityRowidOnly: boolean;
  checkConstraints: boolean;
  schemas: boolean;
  /** Can add foreign keys with ALTER TABLE (SQLite cannot). */
  alterAddForeignKey: boolean;
  onDelete: RefAction[];
  onUpdate: RefAction[];
}

export interface TypeMapping {
  type: DataType;
  /** Present when the conversion loses information (shown with ⚠ in the conversion review). */
  lossy?: string;
}

export interface Dialect {
  id: EngineId;
  displayName: string;
  /** Supported versions, oldest first. */
  versions: string[];
  defaultVersion?: string;
  identifiers: IdentifierRules;
  types: TypeDescriptor[];
  capabilities: Capabilities;
  /** Physical type for a logical type, carrying over length/precision from `source` where possible. */
  mapLogical(logical: LogicalTypeName, source: DataType | undefined, version: string | undefined): TypeMapping;
  /** Logical equivalent of a physical type (handles cases like Oracle NUMBER(10,0) → integer). */
  toLogical(type: DataType): LogicalTypeName;
}
