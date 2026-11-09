import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useStore } from './store/store';
import { loadAutosave, startAutosave } from './store/persistence';
import { useKeyboard } from './lib/useKeyboard';
import { useActions } from './lib/actions';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/inspector/Inspector';
import { ConfirmDialog, Toasts } from './components/Overlays';

export function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    loadAutosave().then((saved) => {
      if (saved && saved.project.model.tables.length) useStore.getState().loadProject(saved.project, 'Restored your last session');
      else if (saved) useStore.getState().loadProject(saved.project);
      stop = startAutosave();
      setReady(true);
    });
    return () => stop?.();
  }, []);
  if (!ready) return <div className="h-full grid place-items-center text-muted">Loading…</div>;
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

function Workspace() {
  useKeyboard();
  const a = useActions();
  const leftOpen = useStore((s) => s.leftOpen);
  const hasSelection = useStore((s) => s.selection.tables.length + s.selection.relationships.length > 0);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const sheetOpen = narrow && hasSelection;
  return (
    <div className={`layout${leftOpen ? ' left-open' : ''}${sheetOpen ? ' sheet-open' : ''}`}>
      <TopBar />
      <div className="main">
        <LeftPanel />
        <main className="relative min-w-0 min-h-0" aria-label="Diagram canvas">
          <Canvas />
          <button className="only-sm fixed right-4 bottom-20 w-12 h-12 rounded-full text-white text-2xl grid place-items-center z-20" style={{ background: 'var(--grad-accent)', boxShadow: '0 8px 20px -8px rgba(214,36,110,.6)' }}
            onClick={a.addTable} aria-label="Add table">＋</button>
        </main>
        <Inspector />
      </div>
      <div className="scrim" onClick={() => { useStore.getState().setLeftOpen(false); useStore.getState().select(null); }} />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
