import { makeCheck, makeIndex, makeUnique, type Id, type Table, type TableItemKind } from '@erd/model';
import type { Issue } from '@erd/validation';
import { useStore } from '../../store/store';
import { InlineIssues } from '../EngineUi';

/**
 * Unique constraints, check constraints and indexes for a table (roadmap Phase 2).
 * Names are optional: the DDL generator derives uq_/ck_/ix_ names when they are blank.
 */
export function ConstraintsEditor({ table, issues }: { table: Table; issues: Issue[] }) {
  const dispatch = (c: Parameters<ReturnType<typeof useStore.getState>['dispatch']>[0], key?: string) => useStore.getState().dispatch(c, key ? { coalesceKey: key } : undefined);
  const upd = (kind: TableItemKind, itemId: Id, patch: Record<string, unknown>, field?: string) => dispatch({ type: 'updateTableItem', tableId: table.id, kind, itemId, patch }, field ? `${itemId}:${field}` : undefined);
  const remove = (kind: TableItemKind, itemId: Id) => dispatch({ type: 'removeTableItem', tableId: table.id, kind, itemId });
  const firstFree = table.columns[0]?.id;
  const itemIssues = (id: Id) => issues.filter((i) => i.target.itemId === id);
  const total = (table.uniques?.length ?? 0) + (table.checks?.length ?? 0) + (table.indexes?.length ?? 0);

  return (
    <div data-testid="constraints-editor">
      <div className="section-label flex justify-between items-center mx-3.5 mt-4 mb-2"><span>Constraints &amp; indexes</span><span className="normal-case tracking-normal font-medium">{total}</span></div>
      <div className="grid grid-cols-1 gap-2 px-3.5">
        {(table.uniques ?? []).map((u) => (
          <Item key={u.id} badge="UNIQUE" name={u.name} placeholder={`uq_${table.name}`} onName={(v) => upd('uniques', u.id, { name: v || undefined }, 'name')} onRemove={() => remove('uniques', u.id)} issues={itemIssues(u.id)}>
            <ColumnSet table={table} ids={u.columnIds} onChange={(ids) => upd('uniques', u.id, { columnIds: ids })} />
          </Item>
        ))}
        {(table.indexes ?? []).map((ix) => (
          <Item key={ix.id} badge={ix.unique ? 'UNIQUE INDEX' : 'INDEX'} name={ix.name} placeholder={`ix_${table.name}`} onName={(v) => upd('indexes', ix.id, { name: v || undefined }, 'name')} onRemove={() => remove('indexes', ix.id)} issues={itemIssues(ix.id)}
            extra={<button className="pill-toggle" aria-pressed={!!ix.unique} onClick={() => upd('indexes', ix.id, { unique: ix.unique ? undefined : true })} title="Unique index">UQ</button>}>
            <ColumnSet table={table} ids={ix.columnIds} ordered onChange={(ids) => upd('indexes', ix.id, { columnIds: ids })} />
          </Item>
        ))}
        {(table.checks ?? []).map((k) => (
          <Item key={k.id} badge="CHECK" name={k.name} placeholder={`ck_${table.name}`} onName={(v) => upd('checks', k.id, { name: v || undefined }, 'name')} onRemove={() => remove('checks', k.id)} issues={itemIssues(k.id)}>
            <input className="input mono text-[11.5px] w-full" placeholder="e.g. quantity > 0" aria-label="Check expression" value={k.expression} onChange={(e) => upd('checks', k.id, { expression: e.target.value }, 'expr')} />
          </Item>
        ))}
        <div className="flex gap-1.5 min-w-0">
          <button className="btn btn-sm flex-1 justify-center border-dashed" disabled={!firstFree} onClick={() => dispatch({ type: 'addTableItem', tableId: table.id, kind: 'uniques', item: makeUnique([firstFree!]) })} data-testid="add-unique">＋ Unique</button>
          <button className="btn btn-sm flex-1 justify-center border-dashed" disabled={!firstFree} onClick={() => dispatch({ type: 'addTableItem', tableId: table.id, kind: 'indexes', item: makeIndex([firstFree!]) })} data-testid="add-index">＋ Index</button>
          <button className="btn btn-sm flex-1 justify-center border-dashed" onClick={() => dispatch({ type: 'addTableItem', tableId: table.id, kind: 'checks', item: makeCheck('') })} data-testid="add-check">＋ Check</button>
        </div>
      </div>
    </div>
  );
}

function Item({ badge, name, placeholder, onName, onRemove, issues, extra, children }: { badge: string; name?: string; placeholder: string; onName: (v: string) => void; onRemove: () => void; issues: Issue[]; extra?: React.ReactNode; children: React.ReactNode }) {
  const worst = issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : '';
  return (
    <div className={`col-card${worst ? ` sev-${worst}` : ''}`} data-testid={`item-${badge.toLowerCase().replace(' ', '-')}`}>
      <div className="flex gap-1.5 items-center">
        <span className="text-[9.5px] font-extrabold tracking-wider text-white rounded px-1.5 py-0.5 shrink-0" style={{ background: 'var(--grad-accent)' }}>{badge}</span>
        <input className="input mono text-[11.5px] flex-1 min-w-0" placeholder={`${placeholder}… (auto)`} aria-label={`${badge} name`} value={name ?? ''} onChange={(e) => onName(e.target.value)} />
        {extra}
        <button className="icon-btn w-7 h-7 text-[12px] opacity-60 hover:opacity-100" onClick={onRemove} title="Delete" aria-label={`Delete ${badge.toLowerCase()}`}>🗑</button>
      </div>
      {children}
      <InlineIssues issues={issues} compact />
    </div>
  );
}

/** Column chips with remove buttons, plus a picker to add a column. Order matters for indexes. */
function ColumnSet({ table, ids, onChange, ordered }: { table: Table; ids: Id[]; onChange: (ids: Id[]) => void; ordered?: boolean }) {
  const name = (id: Id) => table.columns.find((c) => c.id === id)?.name ?? '?';
  const free = table.columns.filter((c) => !ids.includes(c.id));
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {ids.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[#f3efff] text-[11.5px] mono">
          {ordered && ids.length > 1 && <span className="text-muted text-[10px]">{i + 1}</span>}
          {name(id)}
          <button className="text-muted hover:text-err px-0.5 disabled:opacity-30" disabled={ids.length === 1} onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={`Remove ${name(id)}`} title={ids.length === 1 ? 'At least one column is needed' : 'Remove'}>✕</button>
        </span>
      ))}
      {free.length > 0 && (
        <select className="input text-[11.5px] !py-0.5 w-auto" value="" aria-label="Add column" onChange={(e) => e.target.value && onChange([...ids, e.target.value])}>
          <option value="">＋ column…</option>
          {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </div>
  );
}
