import { diffModel, Validator, type ValidationResult } from '@erd/validation';
import type { Project } from '@erd/model';
import { useStore } from '../store/store';
import ValidationWorker from './validation.worker?worker&inline';

const DEBOUNCE_MS = 100;

/**
 * Validates the project whenever the model changes: diffs the previous and next snapshots on the main
 * thread (cheap identity checks) and sends only the changed IDs to the worker, which re-runs the affected rules.
 * Falls back to validating on the main thread if workers are unavailable.
 */
export function startValidation(): () => void {
  let worker: Worker | null = null;
  const local = new Validator();
  try { worker = new ValidationWorker(); } catch (e) { console.warn('Validation worker unavailable; validating on the main thread', e); }

  let seq = 0;
  let lastSent: Project | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = (s: number, result: ValidationResult) => { if (s === seq) useStore.getState().setValidation(result); };

  if (worker) worker.onmessage = (e: MessageEvent<{ seq: number; result: ValidationResult }>) => apply(e.data.seq, e.data.result);

  const run = () => {
    const project = useStore.getState().project;
    const changes = diffModel(lastSent, project);
    lastSent = project;
    const s = ++seq;
    if (worker) worker.postMessage({ seq: s, project, changes });
    else apply(s, local.validate(project, changes));
  };

  let lastModel = useStore.getState().project.model;
  let lastTarget = useStore.getState().project.target;
  run();
  const unsubscribe = useStore.subscribe((s) => {
    // Layout/viewport changes do not affect validation.
    if (s.project.model === lastModel && s.project.target === lastTarget) return;
    lastModel = s.project.model;
    lastTarget = s.project.target;
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });
  return () => { clearTimeout(timer); unsubscribe(); worker?.terminate(); };
}
