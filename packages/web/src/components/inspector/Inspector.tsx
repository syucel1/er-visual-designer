import { useEffect, useRef } from 'react';
import {
  addColumnCommand, cardinality, relationshipDisplayName, REF_ACTIONS, TABLE_COLORS,
  type Id, type Project, type RefAction, type Relationship, type Table,
} from '@erd/model';
import { useStore } from '../../store/store';
import { useActions } from '../../lib/actions';
import { ColumnCard } from './ColumnCard';

const SWATCH: Record<string, string> = { sunrise: 'linear-gradient(120deg,#c2410c,#be123c)', violet: 'linear-gradient(120deg,#6d3ff0,#4f46e5)', blue: 'linear-gradient(120deg,#1d4ed8,#0369a1)', teal: 'linear-gradient(120deg,#0f766e,#0e7490)', green: 'linear-gradient(120deg,#047857,#15803d)', amber: 'linear-gradient(120deg,#b45309,#a16207)', slate: 'linear-gradient(120deg,#334155,#475569)' };

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const { tables, relationships } = selection;
  let body: React.ReactNode;
  if (tables.length === 1 && !relationships.length) {
    const t = project.model.tables.find((x) => x.id === tables[0]);
    body = t ? <TableEditor key={t.id} table={t} project={project} focusColumn={selection.focusColumn} /> : null;
  } else if (relationships.length === 1 && !tables.length) {
    const r = project.model.relationships.find((x) => x.id === relationships[0]);
    body = r ? <RelationshipEditor key={r.id} rel={r} project={project} /> : null;
  } else if (tables.length + relationships.length > 1) {
    body = <MultiSelection tables={tables.length} relationships={relationships.length} />;
  }
  return (
    <aside className="right-panel" aria-label="Properties" data-testid="inspector">
      {body ?? <EmptyInspector />}
    </aside>
  );
}

function Head({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 px-3.5 pt-3.5 pb-2.5 sticky top-0 bg-white z-10 border-b border-line">
      <div className="min-w-0 flex-1"><div className="kicker">{kicker}</div>{children}</div>
      <button className="icon-btn" onClick={() => useStore.getState().select(null)} title="Close (Esc)" aria-label="Close editor">✕</button>
    </div>
  );
}
const SectionTitle = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="section-label flex justify-between items-center mx-3.5 mt-4 mb-2"><span>{children}</span>{right}</div>
);

function TableEditor({ table, project, focusColumn }: { table: Table; project: Project; focusColumn?: Id }) {
  const a = useActions();
  const titleRef = useRef<HTMLInputElement>(null);
  const focusRequest = useStore((s) => s.focusRequest);
  const pk = new Set(table.primaryKey?.columnIds ?? []);
  const rels = project.model.relationships.filter((r) => r.childTableId === table.id || r.parentTableId === table.id);
  const fk = new Set(project.model.relationships.filter((r) => r.childTableId === table.id).flatMap((r) => r.columns.map((p) => p.child)));
  const upd = (patch: Partial<Table>, field?: string) => useStore.getState().dispatch({ type: 'updateTable', tableId: table.id, patch }, field ? { coalesceKey: `table:${table.id}:${field}` } : undefined);

  useEffect(() => {
    if (focusRequest?.id === table.id) setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select(); }, 30);
  }, [focusRequest, table.id]);
  useEffect(() => {
    if (!focusColumn) return;
    const el = document.querySelector(`[data-col="${focusColumn}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusColumn]);

  const addColumn = () => {
    const s = useStore.getState();
    const { command, column } = addColumnCommand(s.project, table.id);
    if (s.dispatch(command)) {
      s.select({ tables: [table.id], focusColumn: column.id });
      setTimeout(() => { const el = document.querySelector<HTMLInputElement>(`[data-col="${column.id}"] input`); el?.focus(); el?.select(); }, 40);
    }
  };

  return (
    <div data-testid="table-editor">
      <Head kicker="Table">
        <input ref={titleRef} className="w-full text-[17px] font-bold border border-transparent hover:border-line focus:border-brand-2 focus:outline-none rounded-md px-1 -ml-1.5 bg-transparent" value={table.name} aria-label="Table name"
          onChange={(e) => upd({ name: e.target.value }, 'name')} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Head>
      <div className="grid grid-cols-[1fr_auto] gap-3 px-3.5 pt-3 items-end">
        <label className="grid gap-1 text-[11.5px] text-muted">Schema <input className="input text-ink" placeholder="(default)" value={table.schema ?? ''} onChange={(e) => upd({ schema: e.target.value || undefined }, 'schema')} /></label>
        <div className="grid gap-1 text-[11.5px] text-muted">Colour
          <div className="flex gap-1 pb-1">{TABLE_COLORS.map((c) => (
            <button key={c} className="swatch-btn" style={{ background: SWATCH[c] }} aria-pressed={(table.color ?? 'sunrise') === c} aria-label={`Colour ${c}`} title={c} onClick={() => upd({ color: c })} />
          ))}</div>
        </div>
      </div>
      <SectionTitle right={<span className="normal-case tracking-normal font-medium">{table.columns.length}</span>}>Columns</SectionTitle>
      <div className="grid gap-2 px-3.5">
        {table.columns.map((c, i) => (
          <ColumnCard key={c.id} tableId={table.id} column={c} index={i} count={table.columns.length} isPk={pk.has(c.id)} isFk={fk.has(c.id)} focused={focusColumn === c.id} />
        ))}
      </div>
      <div className="px-3.5 mt-2"><button className="btn w-full justify-center border-dashed" onClick={addColumn} data-testid="add-column">＋ Add column</button></div>
      <SectionTitle>Relationships</SectionTitle>
      <div className="grid gap-1.5 px-3.5">
        {rels.map((r) => <RelItem key={r.id} r={r} project={project} />)}
        {!rels.length && <p className="text-[11.5px] text-muted">Drag from a column’s ● handle onto a column in another table to create a foreign key.</p>}
      </div>
      <SectionTitle>Comment</SectionTitle>
      <div className="px-3.5"><textarea className="input w-full" rows={2} placeholder="What does this table hold?" value={table.comment ?? ''} onChange={(e) => upd({ comment: e.target.value || undefined }, 'comment')} /></div>
      <div className="flex gap-2 px-3.5 py-4">
        <button className="btn" onClick={a.duplicateSelected} title="Ctrl+D">⧉ Duplicate</button>
        <button className="btn btn-danger" onClick={a.deleteSelection} title="Delete">🗑 Delete table</button>
      </div>
    </div>
  );
}

function RelItem({ r, project }: { r: Relationship; project: Project }) {
  const a = useActions();
  const c = project.model.tables.find((t) => t.id === r.childTableId)!;
  const p = project.model.tables.find((t) => t.id === r.parentTableId)!;
  const col = (t: Table, id: Id) => t.columns.find((x) => x.id === id)?.name;
  return (
    <button className="text-left px-2.5 py-2 rounded-lg border border-line bg-[#fbfbfe] hover:border-brand-2 text-[12px]" onClick={() => { useStore.getState().select({ relationships: [r.id] }); a.focusTable(r.childTableId); }}>
      <span>{c.name}.<b>{r.columns.map((x) => col(c, x.child)).join(', ')}</b> → {p.name}.<b>{r.columns.map((x) => col(p, x.parent)).join(', ')}</b></span>
      <span className="block text-[11px] text-muted mono">{relationshipDisplayName(r, project.model)}</span>
    </button>
  );
}

function RelationshipEditor({ rel, project }: { rel: Relationship; project: Project }) {
  const a = useActions();
  const child = project.model.tables.find((t) => t.id === rel.childTableId)!;
  const parent = project.model.tables.find((t) => t.id === rel.parentTableId)!;
  const card = cardinality(project, rel);
  const s = () => useStore.getState();
  const upd = (patch: Partial<Relationship>, field?: string) => s().dispatch({ type: 'updateRelationship', relationshipId: rel.id, patch }, field ? { coalesceKey: `rel:${rel.id}:${field}` } : undefined);
  const setPair = (i: number, side: 'child' | 'parent', id: Id) => upd({ columns: rel.columns.map((p, j) => (j === i ? { ...p, [side]: id } : p)) });
  const usedChild = new Set(rel.columns.map((p) => p.child)), usedParent = new Set(rel.columns.map((p) => p.parent));
  const freeChild = child.columns.find((c) => !usedChild.has(c.id)), freeParent = parent.columns.find((c) => !usedParent.has(c.id));

  return (
    <div data-testid="relationship-editor">
      <Head kicker="Relationship">
        <input className="w-full text-[14px] font-semibold mono border border-transparent hover:border-line focus:border-brand-2 focus:outline-none rounded-md px-1 -ml-1.5 bg-transparent" placeholder={relationshipDisplayName({ ...rel, name: undefined }, project.model)}
          value={rel.name ?? ''} aria-label="Relationship name" onChange={(e) => upd({ name: e.target.value || undefined }, 'name')} />
      </Head>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center m-3.5">
        <button className="text-left p-2.5 rounded-xl border border-line bg-[#fbfbfe] hover:border-brand-2" onClick={() => { s().select({ tables: [child.id] }); a.focusTable(child.id); }}>
          <small className="block text-muted text-[10.5px]">Child ({card.oneToOne ? 'one' : 'many'})</small><b>{child.name}</b>
        </button>
        <span className="text-lg font-extrabold" style={{ background: 'var(--grad-accent)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>→</span>
        <button className="text-left p-2.5 rounded-xl border border-line bg-[#fbfbfe] hover:border-brand-2" onClick={() => { s().select({ tables: [parent.id] }); a.focusTable(parent.id); }}>
          <small className="block text-muted text-[10.5px]">Parent (one)</small><b>{parent.name}</b>
        </button>
      </div>
      <p className="mx-3.5 text-[11.5px] text-muted">
        Each {child.name} row {card.childOptional ? 'may reference' : 'must reference'} one {parent.name} row; {card.oneToOne ? 'each' : 'a'} {parent.name} row has {card.oneToOne ? 'at most one' : 'any number of'} {child.name} rows.
      </p>
      <SectionTitle>Columns</SectionTitle>
      <div className="grid gap-1.5 px-3.5">
        {rel.columns.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-1.5 items-center">
            <select className="input mono text-[11.5px]" value={p.child} aria-label={`Child column ${i + 1}`} onChange={(e) => setPair(i, 'child', e.target.value)}>
              {child.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="text-muted">→</span>
            <select className="input mono text-[11.5px]" value={p.parent} aria-label={`Parent column ${i + 1}`} onChange={(e) => setPair(i, 'parent', e.target.value)}>
              {parent.columns.map((c) => <option key={c.id} value={c.id}>{c.name}{parent.primaryKey?.columnIds.includes(c.id) ? ' (PK)' : ''}</option>)}
            </select>
            <button className="icon-btn w-7 h-7 text-[12px]" disabled={rel.columns.length === 1} title="Remove pair" aria-label="Remove column pair" onClick={() => upd({ columns: rel.columns.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="btn btn-sm justify-center border-dashed" disabled={!freeChild || !freeParent} onClick={() => freeChild && freeParent && upd({ columns: [...rel.columns, { child: freeChild.id, parent: freeParent.id }] })}>＋ Add column pair (composite key)</button>
      </div>
      <SectionTitle>Actions</SectionTitle>
      <div className="grid grid-cols-2 gap-3 px-3.5">
        {(['onDelete', 'onUpdate'] as const).map((k) => (
          <label key={k} className="grid gap-1 text-[11.5px] text-muted">{k === 'onDelete' ? 'On delete' : 'On update'}
            <select className="input text-ink" value={rel[k]} onChange={(e) => upd({ [k]: e.target.value as RefAction })}>
              {REF_ACTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="px-3.5 py-4"><button className="btn btn-danger" onClick={a.deleteSelection}>🗑 Delete relationship</button></div>
    </div>
  );
}

function MultiSelection({ tables, relationships }: { tables: number; relationships: number }) {
  const a = useActions();
  return (
    <div className="p-6 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl grid place-items-center text-white text-xl" style={{ background: 'var(--grad-accent)' }}>▦</div>
      <p className="font-bold mt-3">{[tables && `${tables} tables`, relationships && `${relationships} relationships`].filter(Boolean).join(' and ')} selected</p>
      <p className="text-muted text-[12px] mt-1">Drag any selected header to move them together, or use the arrow keys.</p>
      <div className="flex gap-2 justify-center mt-4">
        {tables > 1 && <button className="btn" onClick={a.autoLayout}>✦ Arrange selected</button>}
        <button className="btn btn-danger" onClick={a.deleteSelection}>🗑 Delete</button>
      </div>
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="px-6 py-10 text-center text-muted">
      <div className="mx-auto w-14 h-14 rounded-2xl grid place-items-center text-white text-2xl" style={{ background: 'var(--grad-accent)' }}>▦</div>
      <b className="block text-ink text-[14px] mt-3 mb-1.5">Nothing selected</b>
      <p>Select a table or relationship to edit it. Drag a <b>Table</b> from the palette to create one.</p>
      <div className="flex gap-3 justify-center flex-wrap mt-4 text-[11px]">
        {[['T', 'new table'], ['Del', 'delete'], ['Ctrl+Z', 'undo'], ['Ctrl+D', 'duplicate'], ['Ctrl+S', 'save file']].map(([k, d]) => (
          <span key={k}><kbd className="border border-line border-b-2 rounded px-1.5 text-[10.5px] bg-white">{k}</kbd> {d}</span>
        ))}
      </div>
    </div>
  );
}
