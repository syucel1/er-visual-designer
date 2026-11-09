import { useMemo, useState } from 'react';
import { relationshipDisplayName } from '@erd/model';
import { useStore } from '../store/store';
import { useActions } from '../lib/actions';
import { PALETTE_MIME } from './Canvas';

/** Palette (drag sources) above the Explorer (design §9.5). */
export function LeftPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const a = useActions();
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const { tables, relationships } = project.model;
  const shownTables = useMemo(() => tables.filter((t) => t.name.toLowerCase().includes(f)).sort((x, y) => x.name.localeCompare(y.name)), [tables, f]);
  const shownRels = useMemo(() => relationships.filter((r) => relationshipDisplayName(r, project.model).toLowerCase().includes(f)), [relationships, project.model, f]);

  const pal = (kind: 'table' | 'relationship', icon: string, title: string, hint: string, onClick: () => void) => (
    <button
      className="pal-item"
      draggable
      data-testid={`palette-${kind}`}
      onDragStart={(e) => { e.dataTransfer.setData(PALETTE_MIME, kind); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={() => { onClick(); useStore.getState().setLeftOpen(false); }}
      title={`Drag onto the canvas, or click to ${kind === 'table' ? 'add one' : 'see how to link columns'}`}
    >
      <span className="pal-ico" aria-hidden>{icon}</span>
      <span><b className="block text-[12.5px]">{title}</b><small className="text-muted text-[11px]">{hint}</small></span>
    </button>
  );

  const choose = (kind: 'table' | 'relationship', id: string) => {
    const s = useStore.getState();
    if (kind === 'table') { s.select({ tables: [id] }); a.focusTable(id); }
    else {
      s.select({ relationships: [id] });
      const r = relationships.find((x) => x.id === id);
      if (r) a.focusTable(r.childTableId);
    }
    s.setLeftOpen(false);
  };

  return (
    <aside className="left-panel p-3" aria-label="Palette and explorer">
      <div className="section-label flex justify-between mb-2"><span>Palette</span><span className="normal-case tracking-normal font-medium">drag onto canvas</span></div>
      <div className="grid gap-2 mb-5">
        {pal('table', '▦', 'Table', 'Entity with columns', a.addTable)}
        {pal('relationship', '⟷', 'Relationship', 'Foreign key between columns', a.showLinkHint)}
        <div className="pal-item opacity-50 cursor-not-allowed" title="Views arrive in a later phase" aria-disabled>
          <span className="pal-ico" aria-hidden>◉</span>
          <span><b className="block text-[12.5px]">View</b><small className="text-muted text-[11px]">Coming in a later phase</small></span>
        </div>
      </div>
      <div className="section-label mb-2">Explorer</div>
      <input className="input w-full mb-3" placeholder="Filter tables and relationships…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter explorer" />
      <Section title="Tables" count={shownTables.length}>
        {shownTables.map((t) => (
          <button key={t.id} className={`ex-item${selection.tables.includes(t.id) ? ' active' : ''}`} onClick={() => choose('table', t.id)}>
            <span className="opacity-70 w-4 text-center" aria-hidden>▦</span>
            <span className="flex-1 truncate">{t.name}</span>
            <span className="text-[11px] text-muted">{t.columns.length} cols</span>
          </button>
        ))}
        {!shownTables.length && <Empty>{tables.length ? 'No matches' : 'No tables yet'}</Empty>}
      </Section>
      <Section title="Relationships" count={shownRels.length}>
        {shownRels.map((r) => {
          const c = tables.find((t) => t.id === r.childTableId), p = tables.find((t) => t.id === r.parentTableId);
          return (
            <button key={r.id} className={`ex-item${selection.relationships.includes(r.id) ? ' active' : ''}`} onClick={() => choose('relationship', r.id)} title={relationshipDisplayName(r, project.model)}>
              <span className="opacity-70 w-4 text-center" aria-hidden>⟷</span>
              <span className="flex-1 truncate">{c?.name} → {p?.name}</span>
              <span className="text-[11px] text-muted">{r.columns.length > 1 ? `${r.columns.length} cols` : ''}</span>
            </button>
          );
        })}
        {!shownRels.length && <Empty>{relationships.length ? 'No matches' : 'Drag between columns to link tables'}</Empty>}
      </Section>
    </aside>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex justify-between text-[11.5px] font-semibold text-muted px-1 py-1">
        <span>{title}</span><span className="font-medium bg-[#f0f1f7] rounded-full px-2">{count}</span>
      </div>
      {children}
    </div>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <div className="text-[11.5px] text-muted px-2 py-1">{children}</div>;
