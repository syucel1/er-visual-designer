import type { Id, Project } from '@erd/model';
import { getDialect, targetLabel } from '@erd/dialects';
import { RULES } from './rules';
import type { Issue, RuleContext, Severity } from './types';

export interface ChangeSet {
  tables: Id[];
  relationships: Id[];
}

export interface ValidationResult {
  issues: Issue[];
  counts: Record<Severity, number>;
  ms: number;
  mode: 'full' | 'incremental';
  /** Number of tables whose rules actually ran. */
  checkedTables: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Which tables and relationships changed between two project snapshots. Immer keeps unchanged objects
 * identical, so identity comparison is exact and cheap. Returns 'all' when the target engine changed.
 */
export function diffModel(prev: Project | undefined, next: Project): ChangeSet | 'all' {
  if (!prev || prev.target.engine !== next.target.engine || prev.target.version !== next.target.version) return 'all';
  const changed = (a: { id: Id }[], b: { id: Id }[]) => {
    const before = new Map(a.map((x) => [x.id, x]));
    const out = new Set<Id>();
    for (const x of b) { if (before.get(x.id) !== x) out.add(x.id); before.delete(x.id); }
    for (const id of before.keys()) out.add(id);
    return [...out];
  };
  return { tables: changed(prev.model.tables, next.model.tables), relationships: changed(prev.model.relationships, next.model.relationships) };
}

/**
 * Incremental validator (design §6.1): caches issues per table and per relationship and, after an edit,
 * re-runs only the rules for the changed tables, their relationships, and the cheap model-wide rules.
 */
export class Validator {
  private signature = '';
  private tableIssues = new Map<Id, Issue[]>();
  private relIssues = new Map<Id, Issue[]>();

  validate(project: Project, changes: ChangeSet | 'all' = 'all'): ValidationResult {
    const t0 = now();
    const dialect = getDialect(project.target.engine);
    const version = dialect.versions.length ? project.target.version ?? dialect.defaultVersion : undefined;
    const ctx: RuleContext = { project, dialect, version, engineLabel: targetLabel(project.target), tableById: new Map(project.model.tables.map((t) => [t.id, t])) };
    const sig = `${dialect.id}@${version ?? ''}`;
    const full = changes === 'all' || sig !== this.signature;
    this.signature = sig;

    let tablesToCheck: Set<Id>;
    let relsToCheck: Set<Id>;
    if (full) {
      this.tableIssues.clear();
      this.relIssues.clear();
      tablesToCheck = new Set(ctx.tableById.keys());
      relsToCheck = new Set(project.model.relationships.map((r) => r.id));
    } else {
      tablesToCheck = new Set(changes.tables);
      relsToCheck = new Set(changes.relationships);
      for (const r of project.model.relationships) if (tablesToCheck.has(r.childTableId) || tablesToCheck.has(r.parentTableId)) relsToCheck.add(r.id);
    }

    let checked = 0;
    for (const id of tablesToCheck) {
      const t = ctx.tableById.get(id);
      if (!t) { this.tableIssues.delete(id); continue; }
      checked++;
      const out: Issue[] = [];
      for (const rule of RULES) if (rule.scope === 'table') out.push(...rule.check(ctx, t));
      this.tableIssues.set(id, out);
    }
    const relById = new Map(project.model.relationships.map((r) => [r.id, r]));
    for (const id of relsToCheck) {
      const r = relById.get(id);
      if (!r) { this.relIssues.delete(id); continue; }
      const out: Issue[] = [];
      for (const rule of RULES) if (rule.scope === 'relationship') out.push(...rule.check(ctx, r));
      this.relIssues.set(id, out);
    }
    const modelIssues: Issue[] = [];
    for (const rule of RULES) if (rule.scope === 'model') modelIssues.push(...rule.check(ctx));

    const order = new Map(project.model.tables.map((t, i) => [t.id, i]));
    const issues = [...[...this.tableIssues.values()].flat(), ...[...this.relIssues.values()].flat(), ...modelIssues]
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (order.get(a.target.tableId ?? '') ?? 1e9) - (order.get(b.target.tableId ?? '') ?? 1e9) || a.key.localeCompare(b.key));
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const i of issues) counts[i.severity]++;
    return { issues, counts, ms: Math.round((now() - t0) * 10) / 10, mode: full ? 'full' : 'incremental', checkedTables: checked };
  }
}

/** One-shot, stateless validation of a whole project. */
export function validateProject(project: Project): Issue[] {
  return new Validator().validate(project, 'all').issues;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
