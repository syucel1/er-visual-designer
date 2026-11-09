import { applyPatches, type Patch } from 'immer';
import { describe, execute, type Command } from './commands';
import type { Project } from './types';

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /** Entries with the same key within `coalesceMs` merge into one undo step (e.g. typing in one field). */
  key?: string;
  at: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 500;
export const COALESCE_MS = 800;

export const emptyHistory = (): History => ({ past: [], future: [] });

export interface DispatchOptions {
  /** Merge with the previous entry if it has the same key and is recent (continuous typing, nudging). */
  coalesceKey?: string;
  now?: number;
}

export interface DispatchResult {
  project: Project;
  history: History;
  label: string;
}

/** Executes a command and records it in the history. Throws CommandError if the command is invalid. */
export function dispatch(project: Project, history: History, command: Command, opts: DispatchOptions = {}): DispatchResult {
  const now = opts.now ?? Date.now();
  const label = describe(command, project);
  const { project: next, patches, inversePatches } = execute(project, command);
  if (!patches.length) return { project, history, label };
  const last = history.past[history.past.length - 1];
  let past: HistoryEntry[];
  if (opts.coalesceKey && last && last.key === opts.coalesceKey && now - last.at <= COALESCE_MS) {
    const merged: HistoryEntry = {
      label: last.label,
      key: last.key,
      at: now,
      patches: [...last.patches, ...patches],
      inversePatches: [...inversePatches, ...last.inversePatches],
    };
    past = [...history.past.slice(0, -1), merged];
  } else {
    past = [...history.past, { label, key: opts.coalesceKey, at: now, patches, inversePatches }];
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
  }
  return { project: next, history: { past, future: [] }, label };
}

export function canUndo(h: History) { return h.past.length > 0; }
export function canRedo(h: History) { return h.future.length > 0; }

export function undo(project: Project, history: History): DispatchResult | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    project: applyPatches(project, entry.inversePatches),
    history: { past: history.past.slice(0, -1), future: [...history.future, { ...entry, key: undefined }] },
    label: entry.label,
  };
}

export function redo(project: Project, history: History): DispatchResult | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    project: applyPatches(project, entry.patches),
    history: { past: [...history.past, entry], future: history.future.slice(0, -1) },
    label: entry.label,
  };
}
