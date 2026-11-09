import { create } from 'zustand';
import {
  CommandError, createEmptyProject, dispatch as dispatchCommand, emptyHistory, redo as redoHistory, undo as undoHistory,
  type Command, type History, type Id, type Project, type Viewport,
} from '@erd/model';

export interface Selection {
  tables: Id[];
  relationships: Id[];
  /** Column to highlight/scroll to in the inspector. */
  focusColumn?: Id;
}

export interface ToastSpec {
  id: number;
  message: string;
  kind?: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface DialogAction {
  label: string;
  variant?: 'primary' | 'danger' | 'default';
  run: () => void;
}

export interface DialogSpec {
  title: string;
  message: string;
  actions: DialogAction[];
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface State {
  project: Project;
  history: History;
  selection: Selection;
  toasts: ToastSpec[];
  dialog: DialogSpec | null;
  leftOpen: boolean;
  linkHint: boolean;
  saveState: SaveState;
  /** Incremented when the canvas should fit/center (e.g. after loading a project). */
  fitRequest: number;
  focusRequest: { id: Id; n: number } | null;

  /** Executes a command through the history. Returns false (and shows a toast) if it was rejected. */
  dispatch: (command: Command, opts?: { coalesceKey?: string; silent?: boolean }) => boolean;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project, message?: string) => void;
  select: (sel: Partial<Selection> | null) => void;
  setSelectionFromCanvas: (tables: Id[], relationships: Id[]) => void;
  setViewport: (v: Viewport) => void;
  toast: (message: string, opts?: Omit<ToastSpec, 'id' | 'message'>) => void;
  dismissToast: (id: number) => void;
  openDialog: (d: DialogSpec) => void;
  closeDialog: () => void;
  setLeftOpen: (open: boolean) => void;
  setLinkHint: (on: boolean) => void;
  setSaveState: (s: SaveState) => void;
  requestFit: () => void;
  requestFocus: (id: Id) => void;
}

const sameIds = (a: Id[], b: Id[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Drops selected IDs that no longer exist after a change. */
function prune(sel: Selection, p: Project): Selection {
  const tables = sel.tables.filter((id) => p.model.tables.some((t) => t.id === id));
  const relationships = sel.relationships.filter((id) => p.model.relationships.some((r) => r.id === id));
  if (sameIds(tables, sel.tables) && sameIds(relationships, sel.relationships)) return sel;
  return { tables, relationships };
}

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  project: createEmptyProject(),
  history: emptyHistory(),
  selection: { tables: [], relationships: [] },
  toasts: [],
  dialog: null,
  leftOpen: false,
  linkHint: false,
  saveState: 'idle',
  fitRequest: 0,
  focusRequest: null,

  dispatch: (command, opts = {}) => {
    try {
      const { project, history } = get();
      const r = dispatchCommand(project, history, command, { coalesceKey: opts.coalesceKey });
      set({ project: r.project, history: r.history, selection: prune(get().selection, r.project) });
      return true;
    } catch (e) {
      if (!opts.silent) get().toast(e instanceof CommandError ? e.message : `Unexpected error: ${(e as Error).message}`, { kind: 'error' });
      if (!(e instanceof CommandError)) console.error(e);
      return false;
    }
  },

  undo: () => {
    const { project, history } = get();
    const r = undoHistory(project, history);
    if (!r) return;
    set({ project: r.project, history: r.history, selection: prune(get().selection, r.project) });
    get().toast(`Undid: ${r.label}`);
  },

  redo: () => {
    const { project, history } = get();
    const r = redoHistory(project, history);
    if (!r) return;
    set({ project: r.project, history: r.history, selection: prune(get().selection, r.project) });
    get().toast(`Redid: ${r.label}`);
  },

  loadProject: (project, message) => {
    set({ project, history: emptyHistory(), selection: { tables: [], relationships: [] }, fitRequest: get().fitRequest + 1 });
    if (message) get().toast(message);
  },

  select: (sel) => set({ selection: sel ? { tables: sel.tables ?? [], relationships: sel.relationships ?? [], focusColumn: sel.focusColumn } : { tables: [], relationships: [] } }),

  setSelectionFromCanvas: (tables, relationships) => {
    const cur = get().selection;
    if (sameIds(tables, cur.tables) && sameIds(relationships, cur.relationships)) return;
    const keepFocus = tables.length === 1 && cur.tables.length === 1 && tables[0] === cur.tables[0];
    set({ selection: { tables, relationships, focusColumn: keepFocus ? cur.focusColumn : undefined } });
  },

  // The viewport is view state, not a model change: it is saved but not recorded in undo history.
  setViewport: (v) => set((s) => ({ project: { ...s.project, layout: { ...s.project.layout, viewport: v } } })),

  toast: (message, opts = {}) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, ...opts }] }));
    setTimeout(() => get().dismissToast(id), opts.action ? 6000 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setLinkHint: (linkHint) => set({ linkHint }),
  setSaveState: (saveState) => set({ saveState }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  requestFocus: (id) => set((s) => ({ focusRequest: { id, n: (s.focusRequest?.n ?? 0) + 1 } })),
}));

/** Selectors */
export const useProject = () => useStore((s) => s.project);
