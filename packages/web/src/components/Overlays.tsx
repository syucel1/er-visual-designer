import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '../store/store';

/** Confirmation dialog (e.g. FK type mismatch, replacing the project). */
export function ConfirmDialog() {
  const dialog = useStore((s) => s.dialog);
  const close = useStore((s) => s.closeDialog);
  return (
    <Dialog.Root open={!!dialog} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(20,16,40,.35)] z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(480px,92vw)] bg-white rounded-2xl p-6" style={{ boxShadow: '0 30px 80px -20px rgba(40,30,90,.45)' }} data-testid="dialog">
          <div className="h-1 -mx-6 -mt-6 mb-5 rounded-t-2xl" style={{ background: 'var(--grad-accent)' }} />
          <Dialog.Title className="text-[16px] font-bold mb-2">{dialog?.title}</Dialog.Title>
          <Dialog.Description className="text-muted leading-relaxed mb-5">{dialog?.message}</Dialog.Description>
          <div className="flex flex-wrap gap-2 justify-end">
            {dialog?.actions.map((a) => (
              <button key={a.label} className={`btn ${a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : ''}`} onClick={a.run}>{a.label}</button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] flex flex-col items-center gap-2 pointer-events-none" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast pointer-events-auto${t.kind === 'error' ? ' error' : ''}`}>
          <span>{t.message}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
