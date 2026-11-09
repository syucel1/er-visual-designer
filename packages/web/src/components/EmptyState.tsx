import { useActions } from '../lib/actions';

export function EmptyState() {
  const a = useActions();
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none p-6">
      <div className="pointer-events-auto bg-white border border-line rounded-2xl p-7 max-w-md text-center" style={{ boxShadow: 'var(--shadow-float)' }} data-testid="empty-state">
        <div className="mx-auto w-14 h-14 rounded-2xl grid place-items-center text-white text-2xl" style={{ background: 'var(--grad-accent)' }}>▦</div>
        <h2 className="text-lg font-bold mt-3 mb-1">Design your schema</h2>
        <p className="text-muted mb-5">Drag a <b>Table</b> from the palette, double-click the canvas, or start from the sample.</p>
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary justify-center" onClick={a.addTable}>＋ Create your first table</button>
          <button className="btn justify-center" onClick={a.loadSample}>Open sample (e-commerce)</button>
          <button className="btn justify-center" onClick={a.openFile}>Import .erd.json…</button>
        </div>
      </div>
    </div>
  );
}
