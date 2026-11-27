import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ENGINE_ORDER, getDialect, formatTypeLabel } from '../lib/engineLabels';
import type { EngineTarget, Id } from '@erd/model';
import type { Issue, QuickFix } from '@erd/validation';
import { useStore } from '../store/store';
import { useActions } from '../lib/actions';
import { ENGINE_COLORS, useTarget } from '../lib/dialect';

const encode = (t: EngineTarget) => `${t.engine}@${t.version ?? ''}`;
const decode = (v: string): EngineTarget => { const [engine, version] = v.split('@'); return version ? { engine: engine as EngineTarget['engine'], version } : { engine: engine as EngineTarget['engine'] }; };

/** Engine + version picker, grouped by engine (design §9.5 database selector). */
export function EngineSelect({ value, onChange, className, ariaLabel = 'Target database' }: { value: EngineTarget; onChange: (t: EngineTarget) => void; className?: string; ariaLabel?: string }) {
  const d = getDialect(value.engine);
  const current = encode({ engine: value.engine, ...(d.versions.length ? { version: value.version ?? d.defaultVersion } : {}) });
  return (
    <select className={className} value={current} aria-label={ariaLabel} data-testid="engine-select" onChange={(e) => onChange(decode(e.target.value))}>
      {ENGINE_ORDER.map((id) => {
        const dd = getDialect(id);
        if (!dd.versions.length) return <option key={id} value={encode({ engine: id })}>{dd.displayName}</option>;
        return (
          <optgroup key={id} label={dd.displayName}>
            {[...dd.versions].reverse().map((v) => <option key={v} value={encode({ engine: id, version: v })}>{dd.displayName} {v}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

/** Top-bar engine pill. */
export function TopBarEngine() {
  const target = useStore((s) => s.project.target);
  const a = useActions();
  return (
    <label className="tb-btn" title="Target database: types and rules follow this engine">
      <span className="w-2.5 h-2.5 rounded-full ring-2 ring-white/70" style={{ background: ENGINE_COLORS[target.engine] }} aria-hidden />
      <EngineSelect value={target} onChange={a.changeTarget} className="bg-transparent text-white font-semibold outline-none cursor-pointer max-w-[150px] [&_option]:text-ink [&_optgroup]:text-ink" />
    </label>
  );
}

/** Review dialog for converting the model to another engine (roadmap Phase 2). */
export function ConversionDialog() {
  const plan = useStore((s) => s.conversion);
  const setConversion = useStore((s) => s.setConversion);
  const [onlyLossy, setOnlyLossy] = useState(false);
  if (!plan) return null;
  const rows = onlyLossy ? plan.changes.filter((c) => c.lossy) : plan.changes;
  const apply = () => {
    const s = useStore.getState();
    setConversion(null);
    if (s.dispatch(plan.command)) s.toast(`Converted to ${plan.toLabel} — Ctrl+Z to undo`, { action: { label: 'Undo', run: s.undo } });
  };
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) setConversion(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(20,16,40,.35)] z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(760px,94vw)] max-h-[86vh] flex flex-col bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 30px 80px -20px rgba(40,30,90,.45)' }} data-testid="conversion-dialog">
          <div className="h-1" style={{ background: 'var(--grad-accent)' }} />
          <div className="p-6 pb-3">
            <Dialog.Title className="text-[17px] font-bold">Convert to {plan.toLabel}</Dialog.Title>
            <Dialog.Description className="text-muted mt-1">
              From {plan.fromLabel}: <b className="text-ink">{plan.changes.length}</b> column type{plan.changes.length === 1 ? '' : 's'} change, {plan.unchangedColumns} stay the same
              {plan.lossyCount ? <>, <b className="text-warn">⚠ {plan.lossyCount} approximate</b></> : null}. The whole conversion is one undo step.
            </Dialog.Description>
          </div>
          <div className="px-6 flex items-center gap-3 text-[12px]">
            {plan.lossyCount > 0 && <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyLossy} onChange={(e) => setOnlyLossy(e.target.checked)} /> Show only approximate conversions</label>}
          </div>
          <div className="mx-6 my-3 overflow-auto border border-line rounded-xl min-h-0">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-[#f8f8fc] text-muted text-left">
                <tr><th className="px-3 py-2 font-semibold">Column</th><th className="px-3 py-2 font-semibold">From</th><th className="px-3 py-2 font-semibold">To</th><th className="px-3 py-2 font-semibold">Note</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.columnId} className={`border-t border-line ${c.lossy ? 'bg-[#fffbeb]' : ''}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.tableName}.<b>{c.columnName}</b></td>
                    <td className="px-3 py-1.5 mono text-muted whitespace-nowrap">{formatTypeLabel(c.from)}</td>
                    <td className="px-3 py-1.5 mono whitespace-nowrap">{formatTypeLabel(c.to)}</td>
                    <td className="px-3 py-1.5 text-[11.5px]">{c.lossy ? <span className="text-warn">⚠ {c.lossy}</span> : ''}</td>
                  </tr>
                ))}
                {plan.actionChanges.map((a) => (
                  <tr key={a.relationshipId + a.field} className="border-t border-line bg-[#fffbeb]">
                    <td className="px-3 py-1.5">{a.label}</td>
                    <td className="px-3 py-1.5 mono text-muted">{a.field === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'} {a.from.replace('_', ' ').toUpperCase()}</td>
                    <td className="px-3 py-1.5 mono">NO ACTION</td>
                    <td className="px-3 py-1.5 text-[11.5px] text-warn">⚠ not supported by {plan.toLabel}</td>
                  </tr>
                ))}
                {!rows.length && !plan.actionChanges.length && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted">No column types change.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 justify-end px-6 pb-5 pt-1">
            <button className="btn" onClick={() => setConversion(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={apply} data-testid="confirm-conversion">Convert to {plan.toLabel}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** New project: name + database engine (roadmap Phase 2). */
export function NewProjectDialog() {
  const open = useStore((s) => s.newProjectOpen);
  const hasTables = useStore((s) => s.project.model.tables.length > 0);
  const current = useStore((s) => s.project.target);
  const a = useActions();
  const [name, setName] = useState('untitled_schema');
  const [target, setTarget] = useState<EngineTarget>(current);
  const [sample, setSample] = useState(false);
  useEffect(() => { if (open) { setTarget(current.engine === 'generic' ? { engine: 'postgresql', version: '16' } : current); setName('untitled_schema'); setSample(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog.Root open={open} onOpenChange={(o) => useStore.getState().setNewProjectOpen(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(20,16,40,.35)] z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(460px,92vw)] bg-white rounded-2xl p-6" style={{ boxShadow: '0 30px 80px -20px rgba(40,30,90,.45)' }} data-testid="new-project-dialog">
          <div className="h-1 -mx-6 -mt-6 mb-5 rounded-t-2xl" style={{ background: 'var(--grad-accent)' }} />
          <Dialog.Title className="text-[16px] font-bold mb-4">New project</Dialog.Title>
          <Dialog.Description className="sr-only">Choose a name and the database engine for the new project.</Dialog.Description>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); a.createProject(name.trim(), target, sample); }}>
            <label className="grid gap-1 text-[12px] text-muted">Project name
              <input className="input text-ink text-[14px]" value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
            </label>
            <label className="grid gap-1 text-[12px] text-muted">Database
              <EngineSelect value={target} onChange={setTarget} className="input text-ink text-[14px]" ariaLabel="Database for the new project" />
              <span className="text-[11.5px]">Types, naming rules and validation follow this engine. You can convert later.</span>
            </label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} /> Start from the e-commerce sample</label>
            {hasTables && <p className="text-[12px] text-warn bg-[#fffbeb] rounded-lg px-3 py-2">The current project will be replaced. Save it first (File ▸ Save) if you want to keep it.</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn" onClick={() => useStore.getState().setNewProjectOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" data-testid="create-project">Create project</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ issues */

const SEV_ICON = { error: '✖', warning: '▲', info: '●' } as const;
const SEV_CLASS = { error: 'text-err', warning: 'text-warn', info: 'text-info' } as const;

export function applyFix(issue: Issue, fix: QuickFix) {
  const s = useStore.getState();
  if (s.dispatch(fix.commands.length === 1 ? fix.commands[0]! : { type: 'batch', label: fix.label, commands: fix.commands })) s.toast(`Fixed: ${fix.label}`);
  void issue;
}

/** Issues shown inline in the editor, next to the field they concern. */
export function InlineIssues({ issues, compact }: { issues: Issue[]; compact?: boolean }) {
  if (!issues.length) return null;
  return (
    <div className={`grid gap-1 ${compact ? '' : 'mt-1'}`} data-testid="inline-issues">
      {issues.map((i) => (
        <div key={i.key} className={`text-[11.5px] leading-snug rounded-md px-2 py-1.5 ${i.severity === 'error' ? 'bg-[#fff1f3]' : i.severity === 'warning' ? 'bg-[#fffbeb]' : 'bg-[#eff6ff]'}`} title={i.explanation}>
          <span className={`${SEV_CLASS[i.severity]} mr-1`} aria-label={i.severity}>{SEV_ICON[i.severity]}</span>
          <span>{i.message}</span>
          {!compact && <span className="block text-muted mt-0.5">{i.explanation}</span>}
          {i.fixes.length > 0 && (
            <span className="flex flex-wrap gap-1.5 mt-1">
              {i.fixes.map((f) => <button key={f.label} className="btn btn-sm !py-0.5 !text-[11px]" onClick={() => applyFix(i, f)}>⚡ {f.label}</button>)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Status bar under the canvas: engine, issue counts and validation time (roadmap Phase 2; becomes the Problems panel in Phase 3). */
export function StatusBar() {
  const v = useStore((s) => s.validation);
  const open = useStore((s) => s.problemsOpen);
  const { label, dialect } = useTarget();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) useStore.getState().setProblemsOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative border-t border-line bg-white px-3 h-8 flex items-center gap-3 text-[12px] z-10" data-testid="status-bar">
      <span className="flex items-center gap-1.5 font-semibold"><span className="w-2 h-2 rounded-full" style={{ background: ENGINE_COLORS[dialect.id] }} />{label}</span>
      <button className="flex items-center gap-3 px-2 py-0.5 rounded-md hover:bg-hover" onClick={() => useStore.getState().setProblemsOpen(!open)} aria-expanded={open} data-testid="problem-counts" title="Show problems">
        <span className="text-err">✖ {v.counts.error}</span>
        <span className="text-warn">▲ {v.counts.warning}</span>
        <span className="text-info">● {v.counts.info}</span>
      </button>
      <span className="text-muted hide-sm">{v.issues.length ? `${v.counts.error ? 'Fix errors before generating DDL' : 'No errors'}` : '✓ Model is valid'}</span>
      <span className="flex-1" />
      <span className="text-muted hide-sm" title={v.mode === 'incremental' ? 'Only the changed tables were re-checked' : 'The whole model was checked'}>validated in {v.ms} ms</span>
      {open && <ProblemsPopover />}
    </div>
  );
}

function ProblemsPopover() {
  const v = useStore((s) => s.validation);
  const project = useStore((s) => s.project);
  const a = useActions();
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const shown = useMemo(() => v.issues.filter((i) => filter === 'all' || i.severity === filter), [v.issues, filter]);
  const go = (i: Issue) => {
    const s = useStore.getState();
    if (i.target.relationshipId) { s.select({ relationships: [i.target.relationshipId] }); a.focusTable(i.target.tableId!); }
    else if (i.target.tableId) { s.select({ tables: [i.target.tableId], focusColumn: i.target.columnId }); a.focusTable(i.target.tableId as Id); }
    s.setProblemsOpen(false);
  };
  const where = (i: Issue) => {
    const t = project.model.tables.find((x) => x.id === i.target.tableId);
    const c = t?.columns.find((x) => x.id === i.target.columnId);
    return t ? `${t.name}${c ? '.' + c.name : ''}` : '';
  };
  return (
    <div className="absolute left-2 bottom-9 w-[min(640px,calc(100vw-24px))] max-h-[50vh] flex flex-col bg-white border border-line rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-float)' }} data-testid="problems-popover">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line">
        <b className="mr-2">Problems</b>
        {(['all', 'error', 'warning', 'info'] as const).map((f) => (
          <button key={f} className={`px-2.5 py-0.5 rounded-full border text-[11.5px] ${filter === f ? 'border-transparent text-white' : 'border-line'}`} style={filter === f ? { background: 'var(--grad-accent)' } : undefined} onClick={() => setFilter(f)}>
            {f === 'all' ? `All ${v.issues.length}` : `${f[0]!.toUpperCase()}${f.slice(1)}s ${v.counts[f]}`}
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {shown.map((i) => (
          <div key={i.key} className="flex items-start gap-2 px-3 py-2 border-b border-[#f3f3f8] hover:bg-hover cursor-pointer" onClick={() => go(i)} data-testid="problem-row">
            <span className={`${SEV_CLASS[i.severity]} mt-0.5`}>{SEV_ICON[i.severity]}</span>
            <span className="mono text-[10.5px] text-muted mt-0.5 w-[74px] shrink-0">{i.ruleId}</span>
            <span className="flex-1 min-w-0"><span className="block">{i.message}</span><span className="text-[11px] text-muted">{where(i)}</span></span>
            {i.fixes[0] && <button className="btn btn-sm shrink-0" onClick={(e) => { e.stopPropagation(); applyFix(i, i.fixes[0]!); }}>⚡ {i.fixes[0].label}</button>}
          </div>
        ))}
        {!shown.length && <div className="p-6 text-center text-ok font-semibold">✓ No problems</div>}
      </div>
    </div>
  );
}
