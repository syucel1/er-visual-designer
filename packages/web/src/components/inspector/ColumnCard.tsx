import { memo } from 'react';
import { changeType, LOGICAL_TYPES, togglePrimaryKeyCommand, typeInfo, type Column, type Id, type LogicalTypeName } from '@erd/model';
import { useStore } from '../../store/store';

const GROUPS = Array.from(new Set(LOGICAL_TYPES.map((t) => t.category)));

interface Props {
  tableId: Id;
  column: Column;
  index: number;
  count: number;
  isPk: boolean;
  isFk: boolean;
  focused: boolean;
}

/** Function calls such as now() or gen_random_uuid(), and CURRENT_TIMESTAMP-style keywords, are expressions. */
const looksLikeExpression = (v: string) => /^\w+\(.*\)$/.test(v.trim()) || /^current_(date|time|timestamp)$/i.test(v.trim());
const defaultKind = (value: string, prev?: Column['default']): 'literal' | 'expression' =>
  looksLikeExpression(value) || (prev?.kind === 'expression' && !looksLikeExpression(prev.value)) ? 'expression' : 'literal';

const parseIntOrUndef = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : undefined; };

/** One column in the table editor: name, type, size; PK / NN / AI toggles, default, reorder, delete (design §9.5). */
function ColumnCardImpl({ tableId, column: c, index, count, isPk, isFk, focused }: Props) {
  const info = typeInfo(c.type.name);
  const update = (patch: Partial<Column>, field?: string) =>
    useStore.getState().dispatch({ type: 'updateColumn', tableId, columnId: c.id, patch }, field ? { coalesceKey: `col:${c.id}:${field}` } : undefined);
  const s = () => useStore.getState();

  return (
    <div className={`col-card${focused ? ' focused' : ''}`} data-col={c.id} data-testid={`colcard-${c.name}`}>
      <div className="flex gap-1.5 items-center min-w-0">
        <span className="flex flex-col -my-1">
          <button className="text-[10px] leading-none text-muted disabled:opacity-25" disabled={index === 0} onClick={() => s().dispatch({ type: 'moveColumn', tableId, columnId: c.id, toIndex: index - 1 })} aria-label="Move up" title="Move up">▲</button>
          <button className="text-[10px] leading-none text-muted disabled:opacity-25" disabled={index === count - 1} onClick={() => s().dispatch({ type: 'moveColumn', tableId, columnId: c.id, toIndex: index + 1 })} aria-label="Move down" title="Move down">▼</button>
        </span>
        <input className="input flex-1 font-semibold" value={c.name} placeholder="column_name" aria-label="Column name" onChange={(e) => update({ name: e.target.value }, 'name')} />
        <select className="input mono text-[11.5px] w-[104px]" value={c.type.name} aria-label="Data type"
          onChange={(e) => update({ type: changeType(c.type, e.target.value as LogicalTypeName), ...(typeInfo(e.target.value as LogicalTypeName).integer ? {} : { identity: undefined }) })}>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {LOGICAL_TYPES.filter((t) => t.category === g).map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
        {info.param === 'length' && (
          <input className="input mono text-[11.5px] w-12 text-center" inputMode="numeric" placeholder="len" aria-label="Length" title={`Length (1–${info.maxLength})`}
            value={c.type.length ?? ''} onChange={(e) => update({ type: { ...c.type, length: parseIntOrUndef(e.target.value) } }, 'len')} />
        )}
        {info.param === 'precision' && (<>
          <input className="input mono text-[11.5px] w-10 text-center" inputMode="numeric" placeholder="p" aria-label="Precision" title="Precision (total digits)"
            value={c.type.precision ?? ''} onChange={(e) => update({ type: { ...c.type, precision: parseIntOrUndef(e.target.value) } }, 'p')} />
          <input className="input mono text-[11.5px] w-9 text-center" inputMode="numeric" placeholder="s" aria-label="Scale" title="Scale (digits after the decimal point)"
            value={c.type.scale ?? ''} onChange={(e) => update({ type: { ...c.type, scale: parseIntOrUndef(e.target.value) } }, 's')} />
        </>)}
      </div>
      <div className="flex gap-1.5 items-center min-w-0">
        <button className="pill-toggle" aria-pressed={isPk} title="Primary key" onClick={() => s().dispatch(togglePrimaryKeyCommand(s().project, tableId, c.id))}>PK</button>
        <button className="pill-toggle" aria-pressed={!c.nullable} disabled={isPk} title={isPk ? 'Primary-key columns are always NOT NULL' : 'NOT NULL'} onClick={() => update({ nullable: !c.nullable })}>NN</button>
        <button className="pill-toggle" aria-pressed={!!c.identity} disabled={!info.integer} title={info.integer ? 'Auto-increment / identity' : 'Auto-increment needs an integer type'} onClick={() => update(c.identity ? { identity: undefined } : { identity: true, nullable: false, default: undefined })}>AI</button>
        {isFk && <span className="pill-toggle" style={{ background: 'var(--color-fk)', color: '#fff', borderColor: 'transparent' }} title="Foreign key">FK</span>}
        <div className="flex flex-1 min-w-0 items-center">
          <input className="input mono text-[11.5px] flex-1 rounded-r-none" placeholder={c.identity ? 'auto' : 'default'} disabled={!!c.identity} aria-label="Default value"
            value={c.default?.value ?? ''}
            onChange={(e) => update({ default: e.target.value ? { kind: defaultKind(e.target.value, c.default), value: e.target.value } : undefined }, 'default')} />
          <button className={`input rounded-l-none border-l-0 px-1.5 text-[11px] ${c.default?.kind === 'expression' ? 'text-white' : 'text-muted'}`}
            style={c.default?.kind === 'expression' ? { background: 'var(--grad-accent)' } : undefined}
            disabled={!c.default} title={c.default?.kind === 'expression' ? 'Expression (e.g. now()) — click for a literal value' : 'Literal value — click to treat as an expression (e.g. now())'}
            aria-label="Toggle default kind" onClick={() => c.default && update({ default: { ...c.default, kind: c.default.kind === 'expression' ? 'literal' : 'expression' } })}>ƒx</button>
        </div>
        <button className="icon-btn w-7 h-7 text-[12px] opacity-60 hover:opacity-100" title="Delete column" aria-label={`Delete column ${c.name}`}
          onClick={() => s().dispatch({ type: 'removeColumn', tableId, columnId: c.id })}>🗑</button>
      </div>
      <input className="input text-[11.5px]" placeholder="Comment (optional)" aria-label="Column comment" value={c.comment ?? ''} onChange={(e) => update({ comment: e.target.value || undefined }, 'comment')} />
    </div>
  );
}

export const ColumnCard = memo(ColumnCardImpl);
