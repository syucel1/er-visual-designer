import { formatType, type Command, type DataType, type EngineTarget, type Id, type Project, type RefAction } from '@erd/model';
import { findType, versionAtLeast } from './helpers';
import { getDialect, targetLabel } from './engines';

export interface ColumnTypeChange {
  tableId: Id;
  tableName: string;
  columnId: Id;
  columnName: string;
  from: DataType;
  to: DataType;
  /** Why the conversion is approximate (shown with ⚠). */
  lossy?: string;
}

export interface ActionChange {
  relationshipId: Id;
  label: string;
  field: 'onDelete' | 'onUpdate';
  from: RefAction;
  to: RefAction;
}

export interface ConversionPlan {
  fromLabel: string;
  toLabel: string;
  changes: ColumnTypeChange[];
  actionChanges: ActionChange[];
  unchangedColumns: number;
  lossyCount: number;
  /** One batch (setTarget + type changes): a single undo step. */
  command: Command;
}

const ACTION_LABEL: Record<RefAction, string> = { no_action: 'NO ACTION', restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL', set_default: 'SET DEFAULT' };
export const refActionLabel = (a: RefAction) => ACTION_LABEL[a];

/**
 * Plans converting the model to another engine or version (design §5.3, roadmap Phase 2):
 * every column goes physical → logical → physical in the target engine; parameters are carried over and
 * clamped. Within the same engine, only types the new version does not support are changed.
 */
export function planConversion(project: Project, to: EngineTarget): ConversionPlan {
  const fromD = getDialect(project.target.engine);
  const toD = getDialect(to.engine);
  const version = toD.versions.length ? to.version ?? toD.defaultVersion : undefined;
  const target: EngineTarget = version ? { engine: to.engine, version } : { engine: to.engine };
  const sameEngine = fromD.id === toD.id;
  const changes: ColumnTypeChange[] = [];
  let unchanged = 0;

  for (const t of project.model.tables) {
    for (const c of t.columns) {
      let next: DataType;
      let lossy: string | undefined;
      if (sameEngine) {
        const desc = findType(toD, c.type.name);
        if (!desc || versionAtLeast(toD, version, desc.minVersion)) { unchanged++; continue; }
        const m = toD.mapLogical(toD.toLogical(c.type), c.type, version);
        next = m.type;
        lossy = m.lossy ?? `${desc.name} is not available in ${targetLabel(target)}`;
      } else {
        const logical = fromD.toLogical(c.type);
        const m = toD.mapLogical(logical, c.type, version);
        next = m.type;
        lossy = m.lossy;
      }
      if (formatType(next) === formatType(c.type) && next.name === c.type.name && !lossy) {
        // Same spelling (e.g. DATE → DATE): keep but refresh the logical name for the new engine.
        if (next.logical !== c.type.logical) changes.push({ tableId: t.id, tableName: t.name, columnId: c.id, columnName: c.name, from: c.type, to: next });
        else unchanged++;
        continue;
      }
      changes.push({ tableId: t.id, tableName: t.name, columnId: c.id, columnName: c.name, from: c.type, to: next, ...(lossy ? { lossy } : {}) });
    }
  }

  // Referential actions the target engine does not support fall back to NO ACTION.
  const actionChanges: ActionChange[] = [];
  for (const r of project.model.relationships) {
    for (const field of ['onDelete', 'onUpdate'] as const) {
      const allowed = field === 'onDelete' ? toD.capabilities.onDelete : toD.capabilities.onUpdate;
      if (!allowed.includes(r[field])) {
        const child = project.model.tables.find((t) => t.id === r.childTableId)?.name ?? '?';
        const parent = project.model.tables.find((t) => t.id === r.parentTableId)?.name ?? '?';
        actionChanges.push({ relationshipId: r.id, label: `${child} → ${parent}`, field, from: r[field], to: 'no_action' });
      }
    }
  }

  const commands: Command[] = [
    { type: 'setTarget', target },
    ...changes.map((ch): Command => ({ type: 'updateColumn', tableId: ch.tableId, columnId: ch.columnId, patch: { type: ch.to } })),
    ...groupActions(actionChanges),
  ];
  return {
    fromLabel: targetLabel(project.target),
    toLabel: targetLabel(target),
    changes,
    actionChanges,
    unchangedColumns: unchanged,
    lossyCount: changes.filter((c) => c.lossy).length + actionChanges.length,
    command: { type: 'batch', label: `Convert to ${targetLabel(target)}`, commands },
  };
}

function groupActions(changes: ActionChange[]): Command[] {
  const byRel = new Map<Id, Partial<Record<'onDelete' | 'onUpdate', RefAction>>>();
  for (const c of changes) byRel.set(c.relationshipId, { ...(byRel.get(c.relationshipId) ?? {}), [c.field]: c.to });
  return [...byRel].map(([relationshipId, patch]) => ({ type: 'updateRelationship', relationshipId, patch }));
}
