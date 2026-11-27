import { memo, useMemo } from 'react';
import { togglePrimaryKeyCommand, type Column, type Id } from '@erd/model';
import { changeTypeTo, findType, isIntegerType, typesFor, versionAtLeast, type TypeCategory } from '@erd/dialects';
import type { Issue } from '@erd/validation';
import { useStore } from '../../store/store';
import { useTarget } from '../../lib/dialect';
import { InlineIssues } from '../EngineUi';

const CATEGORIES: TypeCategory[] = ['Numeric', 'Text', 'Date & time', 'Boolean', 'Binary', 'Other'];

interface Props {
  tableId: Id;
  column: Column;
  index: number;
  count: number;
  isPk: boolean;
  isFk: boolean;
  focused: boolean;
  issues: Issue[];
}

/** Function calls such as now() or gen_random_uuid(), and CURRENT_TIMESTAMP-style keywords, are expressions. */
const looksLikeExpression = (v: string) => /^\w+\(.*\)$/.test(v.trim()) || /^\(.*\)$/.test(v.trim()) || /^current_(date|time|timestamp)$/i.test(v.trim());
const defaultKind = (value: string, prev?: Column['default']): 'literal' | 'expression' =>
  looksLikeExpression(value) || (prev?.kind === 'expression' && !looksLikeExpression(prev.value)) ? 'expression' : 'literal';
const parseIntOrUndef = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : undefined; };

/** One column in the table editor: name, engine type with its parameters, PK / NN / AI, default, comment (design §9.5). */
function ColumnCardImpl({ tableId, column: c, index, count, isPk, isFk, focused, issues }: Props) {
  const { dialect, version } = useTarget();
  const desc = findType(dialect, c.type.name);
  const unsupported = !desc || !versionAtLeast(dialect, version, desc.minVersion);
  const options = useMemo(() => typesFor(dialect, version), [dialect, version]);
  const integer = isIntegerType(dialect, c.type);
  const update = (patch: Partial<Column>, field?: string) =>
    useStore.getState().dispatch({ type: 'updateColumn', tableId, columnId: c.id, patch }, field ? { coalesceKey: `col:${c.id}:${field}` } : undefined);
  const s = () => useStore.getState();
  const fieldHas = (...fields: string[]) => issues.find((i) => fields.includes(i.target.field ?? '') && i.severity !== 'info')?.severity;
  const ring = (sev?: string) => (sev === 'error' ? ' !border-err' : sev === 'warning' ? ' !border-warn' : '');
  const worst = issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : '';

  return (
    <div className={`col-card${focused ? ' focused' : ''}${worst ? ` sev-${worst}` : ''}`} data-col={c.id} data-testid={`colcard-${c.name}`}>
      <div className="flex gap-1.5 items-center min-w-0">
        <span className="flex flex-col -my-1">
          <button className="text-[10px] leading-none text-muted disabled:opacity-25" disabled={index === 0} onClick={() => s().dispatch({ type: 'moveColumn', tableId, columnId: c.id, toIndex: index - 1 })} aria-label="Move up" title="Move up">▲</button>
          <button className="text-[10px] leading-none text-muted disabled:opacity-25" disabled={index === count - 1} onClick={() => s().dispatch({ type: 'moveColumn', tableId, columnId: c.id, toIndex: index + 1 })} aria-label="Move down" title="Move down">▼</button>
        </span>
        <input className={`input flex-1 min-w-0 font-semibold${ring(fieldHas('name'))}`} value={c.name} placeholder="column_name" aria-label="Column name" onChange={(e) => update({ name: e.target.value }, 'name')} />
        <button className="icon-btn w-7 h-7 text-[12px] opacity-60 hover:opacity-100 shrink-0" title="Delete column" aria-label={`Delete column ${c.name}`}
          onClick={() => s().dispatch({ type: 'removeColumn', tableId, columnId: c.id })}>🗑</button>
      </div>
      <div className="flex gap-1.5 items-center min-w-0">
        <select className={`input mono text-[11.5px] flex-1 min-w-0${ring(fieldHas('type'))}`} value={desc && !unsupported ? desc.name : c.type.name} aria-label="Data type" title={desc?.note}
          onChange={(e) => { const type = changeTypeTo(dialect, c.type, e.target.value); update({ type, ...(isIntegerType(dialect, type) ? {} : { identity: undefined }) }); }}>
          {unsupported && <option value={c.type.name}>{c.type.name} (not supported)</option>}
          {CATEGORIES.map((g) => {
            const list = options.filter((t) => t.category === g);
            return list.length ? (
              <optgroup key={g} label={g}>
                {list.map((t) => <option key={t.name} value={t.name}>{t.name}{t.note ? ` — ${t.note}` : ''}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
        {desc?.length && !unsupported && (
          c.type.max
            ? <button className={`input mono text-[11px] w-[52px] text-center${ring(fieldHas('length'))}`} title="Click to use a fixed length" onClick={() => update({ type: { ...c.type, max: undefined, length: desc.length!.default ?? 255 } })}>MAX</button>
            : <input className={`input mono text-[11.5px] w-[52px] text-center${ring(fieldHas('length'))}`} inputMode="numeric" placeholder={desc.length.required ? 'len*' : 'len'} aria-label="Length"
              title={`Length ${desc.length.min}–${desc.length.max}${desc.length.allowMax ? ' or MAX' : ''}${desc.length.required ? ' (required)' : ''}`}
              value={c.type.length ?? ''} onChange={(e) => {
                const v = e.target.value.trim();
                if (desc.length!.allowMax && /^max$/i.test(v)) update({ type: { ...c.type, length: undefined, max: true } });
                else update({ type: { ...c.type, length: parseIntOrUndef(v) } }, 'len');
              }} />
        )}
        {desc?.precision && !unsupported && (<>
          <input className={`input mono text-[11.5px] w-10 text-center${ring(fieldHas('precision'))}`} inputMode="numeric" placeholder="p" aria-label="Precision" title={`Precision ${desc.precision.min}–${desc.precision.max} (total digits)`}
            value={c.type.precision ?? ''} onChange={(e) => { const p = parseIntOrUndef(e.target.value); update({ type: { ...c.type, precision: p, ...(p == null ? { scale: undefined } : {}), logical: dialect.toLogical({ ...c.type, precision: p }) } }, 'p'); }} />
          <input className={`input mono text-[11.5px] w-9 text-center${ring(fieldHas('precision'))}`} inputMode="numeric" placeholder="s" aria-label="Scale" title="Scale (digits after the decimal point)"
            value={c.type.scale ?? ''} onChange={(e) => { const sc = parseIntOrUndef(e.target.value); update({ type: { ...c.type, scale: sc, logical: dialect.toLogical({ ...c.type, scale: sc }) } }, 's'); }} />
        </>)}
      </div>
      <div className="flex gap-1.5 items-center min-w-0">
        <button className="pill-toggle" aria-pressed={isPk} title="Primary key" onClick={() => s().dispatch(togglePrimaryKeyCommand(s().project, tableId, c.id))}>PK</button>
        <button className={`pill-toggle${ring(fieldHas('nullable'))}`} aria-pressed={!c.nullable} disabled={isPk && !c.nullable} title={isPk ? 'Primary-key columns are always NOT NULL' : 'NOT NULL'} onClick={() => update({ nullable: !c.nullable })}>NN</button>
        <button className={`pill-toggle${ring(fieldHas('identity'))}`} aria-pressed={!!c.identity} disabled={!integer && !c.identity} title={integer ? `Auto-increment: ${dialect.capabilities.identitySyntax}` : 'Auto-increment needs an integer type'} onClick={() => update(c.identity ? { identity: undefined } : { identity: true, nullable: false, default: undefined })}>AI</button>
        {isFk && <span className="pill-toggle" style={{ background: 'var(--color-fk)', color: '#fff', borderColor: 'transparent' }} title="Foreign key">FK</span>}
        <div className="flex flex-1 min-w-0 items-center">
          <input className={`input mono text-[11.5px] flex-1 rounded-r-none${ring(fieldHas('default'))}`} placeholder={c.identity ? 'auto' : 'default'} disabled={!!c.identity} aria-label="Default value"
            value={c.default?.value ?? ''}
            onChange={(e) => update({ default: e.target.value ? { kind: defaultKind(e.target.value, c.default), value: e.target.value } : undefined }, 'default')} />
          <button className={`input rounded-l-none border-l-0 px-1.5 text-[11px] ${c.default?.kind === 'expression' ? 'text-white' : 'text-muted'}`}
            style={c.default?.kind === 'expression' ? { background: 'var(--grad-accent)' } : undefined}
            disabled={!c.default} title={c.default?.kind === 'expression' ? 'Expression (e.g. now()) — click for a literal value' : 'Literal value — click to treat as an expression (e.g. now())'}
            aria-label="Toggle default kind" onClick={() => c.default && update({ default: { ...c.default, kind: c.default.kind === 'expression' ? 'literal' : 'expression' } })}>ƒx</button>
        </div>
      </div>
      <input className="input text-[11.5px]" placeholder="Comment (optional)" aria-label="Column comment" value={c.comment ?? ''} onChange={(e) => update({ comment: e.target.value || undefined }, 'comment')} />
      <InlineIssues issues={issues} compact />
    </div>
  );
}

export const ColumnCard = memo(ColumnCardImpl);
