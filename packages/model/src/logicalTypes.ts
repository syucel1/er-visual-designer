import type { DataType, LogicalTypeName } from './types';

export type TypeParam = 'length' | 'precision' | 'none';

export interface LogicalTypeInfo {
  name: LogicalTypeName;
  label: string;
  category: 'Numeric' | 'Boolean' | 'Text' | 'Date & time' | 'Other';
  param: TypeParam;
  /** Integer types may carry auto-increment. */
  integer?: boolean;
  numeric?: boolean;
  defaultLength?: number;
  defaultPrecision?: number;
  defaultScale?: number;
  maxLength?: number;
}

export const LOGICAL_TYPES: LogicalTypeInfo[] = [
  { name: 'smallint', label: 'smallint', category: 'Numeric', param: 'none', integer: true, numeric: true },
  { name: 'integer', label: 'integer', category: 'Numeric', param: 'none', integer: true, numeric: true },
  { name: 'bigint', label: 'bigint', category: 'Numeric', param: 'none', integer: true, numeric: true },
  { name: 'decimal', label: 'decimal', category: 'Numeric', param: 'precision', numeric: true, defaultPrecision: 12, defaultScale: 2 },
  { name: 'real', label: 'real', category: 'Numeric', param: 'none', numeric: true },
  { name: 'double', label: 'double', category: 'Numeric', param: 'none', numeric: true },
  { name: 'boolean', label: 'boolean', category: 'Boolean', param: 'none' },
  { name: 'varchar', label: 'varchar', category: 'Text', param: 'length', defaultLength: 255, maxLength: 65535 },
  { name: 'char', label: 'char', category: 'Text', param: 'length', defaultLength: 1, maxLength: 255 },
  { name: 'text', label: 'text', category: 'Text', param: 'none' },
  { name: 'date', label: 'date', category: 'Date & time', param: 'none' },
  { name: 'time', label: 'time', category: 'Date & time', param: 'none' },
  { name: 'timestamp', label: 'timestamp', category: 'Date & time', param: 'none' },
  { name: 'timestamptz', label: 'timestamp with time zone', category: 'Date & time', param: 'none' },
  { name: 'uuid', label: 'uuid', category: 'Other', param: 'none' },
  { name: 'json', label: 'json', category: 'Other', param: 'none' },
  { name: 'binary', label: 'binary', category: 'Other', param: 'none' },
];

const BY_NAME = new Map(LOGICAL_TYPES.map((t) => [t.name, t]));

export function typeInfo(name: LogicalTypeName): LogicalTypeInfo {
  const t = BY_NAME.get(name);
  if (!t) throw new Error(`Unknown logical type: ${name}`);
  return t;
}

export function isLogicalType(name: unknown): name is LogicalTypeName {
  return typeof name === 'string' && BY_NAME.has(name as LogicalTypeName);
}

/** A type with its default parameters filled in, e.g. varchar → varchar(255). */
export function defaultDataType(name: LogicalTypeName): DataType {
  const t = typeInfo(name);
  if (t.param === 'length') return { name, length: t.defaultLength };
  if (t.param === 'precision') return { name, precision: t.defaultPrecision, scale: t.defaultScale };
  return { name };
}

/** Re-applies parameters when the type changes, keeping compatible ones. */
export function changeType(current: DataType, name: LogicalTypeName): DataType {
  const t = typeInfo(name);
  if (t.param === 'length') return { name, length: current.length ?? t.defaultLength };
  if (t.param === 'precision') return { name, precision: current.precision ?? t.defaultPrecision, scale: current.scale ?? t.defaultScale };
  return { name };
}

/** Short display form used on table cards, e.g. varchar(255), decimal(12,2). */
export function formatType(t: DataType): string {
  const info = BY_NAME.get(t.name);
  if (!info) return t.name;
  if (info.param === 'length' && t.length != null) return `${t.name}(${t.length})`;
  if (info.param === 'precision' && t.precision != null) return t.scale != null ? `${t.name}(${t.precision},${t.scale})` : `${t.name}(${t.precision})`;
  return t.name === 'timestamptz' ? 'timestamptz' : t.name;
}

export function sameType(a: DataType, b: DataType): boolean {
  return a.name === b.name && (a.length ?? null) === (b.length ?? null) && (a.precision ?? null) === (b.precision ?? null) && (a.scale ?? null) === (b.scale ?? null);
}
