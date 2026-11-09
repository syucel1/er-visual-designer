import { useEffect } from 'react';
import { useStore } from '../store/store';
import { useActions } from './actions';

/** Global shortcuts (design §9.3). Ignored while typing in a field, except Ctrl+S / Ctrl+O. */
export function useKeyboard() {
  const a = useActions();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const el = e.target as HTMLElement;
      const typing = el.matches?.('input, textarea, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') { e.preventDefault(); a.saveFile(); return; }
      if (mod && key === 'o') { e.preventDefault(); a.openFile(); return; }
      if (typing || s.dialog) return;
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (mod && key === 'y') { e.preventDefault(); s.redo(); }
      else if (mod && key === 'd') { e.preventDefault(); a.duplicateSelected(); }
      else if (mod && key === 'a') { e.preventDefault(); s.select({ tables: s.project.model.tables.map((t) => t.id) }); }
      else if (key === 'delete' || key === 'backspace') { if (s.selection.tables.length || s.selection.relationships.length) { e.preventDefault(); a.deleteSelection(); } }
      else if (key === 't' && !mod) { e.preventDefault(); a.addTable(); }
      else if (key === 'escape') { s.select(null); s.setLeftOpen(false); s.setLinkHint(false); }
      else if (key === 'f2' && s.selection.tables.length === 1) { e.preventDefault(); s.requestFocus(s.selection.tables[0]!); }
      else if (key.startsWith('arrow') && s.selection.tables.length) {
        e.preventDefault();
        const step = e.shiftKey ? 80 : 8;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        const pos = s.project.layout.positions;
        s.dispatch({ type: 'moveTables', moves: s.selection.tables.map((id) => ({ tableId: id, to: { x: (pos[id]?.x ?? 0) + dx, y: (pos[id]?.y ?? 0) + dy } })) }, { coalesceKey: `nudge:${s.selection.tables.join(',')}` });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a]);
}
