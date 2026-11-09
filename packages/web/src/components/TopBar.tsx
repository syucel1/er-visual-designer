import { useEffect, useRef, useState } from 'react';
import { canRedo, canUndo } from '@erd/model';
import { useStore } from '../store/store';
import { useActions } from '../lib/actions';

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const history = useStore((s) => s.history);
  const saveState = useStore((s) => s.saveState);
  const linkHint = useStore((s) => s.linkHint);
  const a = useActions();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const item = (label: string, kbd: string, run: () => void) => (
    <button role="menuitem" onClick={() => { setMenu(false); run(); }}><span>{label}</span><kbd>{kbd}</kbd></button>
  );

  return (
    <header className="topbar flex items-center gap-2 px-3 py-2 relative z-20 min-w-0">
      <button className="icon-btn only-sm text-white" onClick={() => useStore.getState().setLeftOpen(true)} aria-label="Open palette and explorer">☰</button>
      <span className="logo shrink-0" aria-hidden><i /><i /><i /></span>
      <span className="font-bold text-[14px] whitespace-nowrap hide-sm">ER Visual Designer</span>
      <span className="opacity-60 hide-sm">/</span>
      <input
        className="project-name"
        value={name}
        aria-label="Project name"
        onChange={(e) => useStore.getState().dispatch({ type: 'renameProject', name: e.target.value }, { coalesceKey: 'project-name' })}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: `${Math.max(8, name.length + 2)}ch` }}
      />
      <label className="tb-btn hide-md" title="Engine-specific types and rules arrive in Phase 2">
        <span className="w-2 h-2 rounded-full bg-white/90" aria-hidden />
        <select disabled className="bg-transparent text-white font-semibold outline-none" aria-label="Target database">
          <option>Generic (logical types)</option>
        </select>
      </label>
      <div className="flex items-center gap-1">
        <button className="tb-btn !px-2" onClick={() => useStore.getState().undo()} disabled={!canUndo(history)} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
        <button className="tb-btn !px-2 hide-sm" onClick={() => useStore.getState().redo()} disabled={!canRedo(history)} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
      </div>
      <div className="flex items-center gap-1 hide-sm">
        <button className="tb-btn" onClick={a.addTable} title="Add table (T)">＋ Table</button>
        <button className={`tb-btn${linkHint ? ' active' : ''}`} onClick={a.showLinkHint} title="How to create a relationship">⟷ Relationship</button>
        <button className="tb-btn hide-md" onClick={a.autoLayout} title="Arrange tables automatically (selected tables only if several are selected)">✦ Auto-layout</button>
        <button className="tb-btn hide-md" onClick={a.fit} title="Fit diagram to screen">⤢ Fit</button>
      </div>
      <div className="flex-1" />
      <span className="text-[11.5px] opacity-85 whitespace-nowrap hide-sm" aria-live="polite" data-testid="save-state">
        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved in browser' : saveState === 'error' ? '⚠ Autosave failed' : ''}
      </span>
      <div className="relative" ref={menuRef}>
        <button className="tb-btn tb-primary" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>File ▾</button>
        {menu && (
          <div className="menu" role="menu">
            {item('New project', '', a.newProject)}
            {item('Open .erd.json…', 'Ctrl+O', a.openFile)}
            {item('Save as .erd.json', 'Ctrl+S', a.saveFile)}
            <div className="h-px bg-line my-1" />
            {item('Open sample (e-commerce)', '', a.loadSample)}
            {item('Auto-layout', '', a.autoLayout)}
            {item('Fit to screen', '', a.fit)}
          </div>
        )}
      </div>
    </header>
  );
}
