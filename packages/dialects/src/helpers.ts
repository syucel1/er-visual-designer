import type { DataType, LogicalTypeName } from '@erd/model';
import type { Dialect, ParamSpec, TypeDescriptor, TypeMapping } from './types';

/* ---------------- building descriptors ---------------- */

export const len = (min: number, max: number, def?: number, extra: Partial<ParamSpec> = {}): ParamSpec => ({ min, max, ...(def != null ? { default: def } : {}), ...extra });

/* ---------------- versions ---------------- */

/** True when `version` is the same as or newer than `min`, by position in the dialect's version list. */
export function versionAtLeast(dialect: Dialect, version: string | undefined, min: string | undefined): boolean {
  if (!min) return true;
  const v = dialect.versions.indexOf(version ?? dialect.defaultVersion ?? dialect.versions[dialect.versions.length - 1]!);
  const m = dialect.versions.indexOf(min);
  return v < 0 || m < 0 ? true : v >= m;
}

/* ---------------- type lookup ---------------- */

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Finds a type by canonical name or alias (case-insensitive). Returns undefined for unknown names. */
export function findType(dialect: Dialect, name: string): TypeDescriptor | undefined {
  const n = norm(name);
  return dialect.types.find((t) => norm(t.name) === n || t.aliases?.some((a) => norm(a) === n));
}

/** Types available in the given version, for the type picker. */
export function typesFor(dialect: Dialect, version: string | undefined): TypeDescriptor[] {
  return dialect.types.filter((t) => versionAtLeast(dialect, version, t.minVersion));
}

/** A data type with the descriptor's default parameters (used when the user picks a type). */
export function defaultTypeFrom(desc: TypeDescriptor): DataType {
  return {
    name: desc.name,
    ...(desc.length?.default != null ? { length: desc.length.default } : {}),
    ...(desc.precision?.default != null ? { precision: desc.precision.default } : {}),
    ...(desc.scale?.default != null && desc.precision?.default != null ? { scale: desc.scale.default } : {}),
    logical: desc.logical,
  };
}

/** Switches a column to another type of the same dialect, keeping compatible parameters. */
export function changeTypeTo(dialect: Dialect, current: DataType, name: string): DataType {
  const desc = findType(dialect, name);
  if (!desc) return { name, logical: current.logical };
  const next: DataType = { name: desc.name, logical: desc.logical };
  if (desc.length) {
    if (current.max && desc.length.allowMax) next.max = true;
    else {
      const l = current.length ?? desc.length.default;
      if (l != null) next.length = Math.min(Math.max(l, desc.length.min), desc.length.max);
    }
  }
  if (desc.precision) {
    const p = current.precision ?? desc.precision.default;
    if (p != null) {
      next.precision = Math.min(Math.max(p, desc.precision.min), desc.precision.max);
      const s = current.scale ?? desc.scale?.default;
      if (s != null) next.scale = Math.min(s, next.precision);
    }
  }
  next.logical = dialect.toLogical(next);
  return next;
}

/** Canonical spelling for a type written with an alias (e.g. int4 → integer); unknown names are returned as-is. */
export function normalizeType(dialect: Dialect, t: DataType): DataType {
  const desc = findType(dialect, t.name);
  if (!desc || desc.name === t.name) return t;
  const out = { ...t, name: desc.name };
  out.logical = dialect.toLogical(out);
  return out;
}

const INTEGER_LOGICAL: LogicalTypeName[] = ['smallint', 'integer', 'bigint'];
const NUMERIC_LOGICAL: LogicalTypeName[] = ['smallint', 'integer', 'bigint', 'decimal', 'real', 'double'];

/** Whether a column of this type can be auto-increment / identity. */
export const isIntegerType = (dialect: Dialect, t: DataType) => INTEGER_LOGICAL.includes(dialect.toLogical(t));
export const isNumericType = (dialect: Dialect, t: DataType) => NUMERIC_LOGICAL.includes(dialect.toLogical(t));

/** Types for new tables' id column and for newly added columns in this engine. */
export function typeDefaults(dialect: Dialect, version: string | undefined): { idType: DataType; columnType: DataType } {
  return {
    idType: dialect.mapLogical('bigint', undefined, version).type,
    columnType: dialect.mapLogical('varchar', { name: 'varchar', length: 255 }, version).type,
  };
}

/* ---------------- mapping helpers used by the dialects ---------------- */

/** Builds a mapping to `desc`, carrying length / precision / scale from the source and clamping to the target ranges. */
export function carry(desc: TypeDescriptor, source: DataType | undefined, lossy?: string): TypeMapping {
  const type: DataType = { name: desc.name, logical: desc.logical };
  const notes: string[] = lossy ? [lossy] : [];
  if (desc.length) {
    if (source?.max && desc.length.allowMax) type.max = true;
    else {
      const want = source?.max ? Infinity : source?.length ?? desc.length.default;
      if (want != null) {
        if (want > desc.length.max) {
          if (desc.length.allowMax) type.max = true;
          else { type.length = desc.length.max; notes.push(`length ${Number.isFinite(want) ? want : 'MAX'} reduced to ${desc.length.max}`); }
        } else type.length = Math.max(want, desc.length.min);
      }
    }
  }
  if (desc.precision) {
    const p = source?.precision ?? desc.precision.default;
    if (p != null) {
      if (p > desc.precision.max) notes.push(`precision ${p} reduced to ${desc.precision.max}`);
      type.precision = Math.min(Math.max(p, desc.precision.min), desc.precision.max);
      const s = source?.scale ?? desc.scale?.default;
      if (s != null) {
        const maxS = Math.min(desc.scale?.max ?? type.precision, type.precision);
        if (s > maxS) notes.push(`scale ${s} reduced to ${maxS}`);
        type.scale = Math.min(s, maxS);
      }
    }
  }
  return { type, ...(notes.length ? { lossy: notes.join('; ') } : {}) };
}

/** Looks a type up by name in the dialect, throwing if the dialect table is inconsistent (a programming error). */
export function typeNamed(types: TypeDescriptor[], name: string): TypeDescriptor {
  const t = types.find((x) => x.name === name);
  if (!t) throw new Error(`Dialect has no type ${name}`);
  return t;
}

export const words = (s: string): ReadonlySet<string> => new Set(s.trim().split(/\s+/).map((w) => w.toLowerCase()));
