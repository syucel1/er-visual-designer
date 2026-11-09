import type { Model, Relationship, Table } from './types';

/** Returns `base`, or `base_2`, `base_3`… so the name is unique (case-insensitive) among `existing`. */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Very small singulariser for FK column names: customers → customer, categories → category, boxes → box. */
export function singular(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(ss|us)$/i.test(word)) return word;
  if (/(x|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && word.length > 1) return word.slice(0, -1);
  return word;
}

/** Name for a new FK column in the child table that references `parentTable.parentColumn`, e.g. customer_id. */
export function fkColumnName(parentTable: Table, parentColumnName: string, child: Table): string {
  return uniqueName(`${singular(parentTable.name)}_${parentColumnName}`, child.columns.map((c) => c.name));
}

/** Deterministic constraint name used when the user has not named a relationship: fk_<child>_<parent>. */
export function relationshipDisplayName(rel: Relationship, model: Model): string {
  if (rel.name) return rel.name;
  const child = model.tables.find((t) => t.id === rel.childTableId);
  const parent = model.tables.find((t) => t.id === rel.parentTableId);
  return `fk_${child?.name ?? '?'}_${parent?.name ?? '?'}`;
}
