import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  addTableCommand, createEmptyProject, createSampleProject, duplicateTableCommand, planConnection,
  type Endpoint, type Id, type Point,
} from '@erd/model';
import { useStore } from '../store/store';
import { autoLayoutCommand } from './autoLayout';
import { openProjectFile, saveProjectFile } from './fileio';

/** UI-level operations shared by the toolbar, palette, keyboard shortcuts and context actions. */
export function useActions() {
  const rf = useReactFlow();

  const viewCenter = useCallback((): Point => {
    const el = document.querySelector('.react-flow');
    const r = el?.getBoundingClientRect();
    if (!r) return { x: 80, y: 80 };
    return rf.screenToFlowPosition({ x: r.left + r.width / 2 - 124, y: r.top + r.height / 3 });
  }, [rf]);

  const addTableAt = useCallback((pos: Point) => {
    const { project, dispatch, select, toast, requestFocus } = useStore.getState();
    const { command, table } = addTableCommand(project, { x: Math.round(pos.x / 8) * 8, y: Math.round(pos.y / 8) * 8 });
    if (dispatch(command)) {
      select({ tables: [table.id] });
      requestFocus(table.id);
      toast(`Added ${table.name} — rename it in the editor`);
    }
  }, []);

  const addTable = useCallback(() => addTableAt(viewCenter()), [addTableAt, viewCenter]);

  const deleteSelection = useCallback(() => {
    const { selection, dispatch, project, toast, undo } = useStore.getState();
    const { tables, relationships } = selection;
    if (!tables.length && !relationships.length) return;
    const commands = [
      ...(relationships.length ? [{ type: 'removeRelationships' as const, relationshipIds: relationships }] : []),
      ...(tables.length ? [{ type: 'removeTables' as const, tableIds: tables }] : []),
    ];
    const names = tables.map((id) => project.model.tables.find((t) => t.id === id)?.name).filter(Boolean);
    const label = names.length === 1 && !relationships.length ? `Deleted ${names[0]}` : `Deleted ${tables.length ? `${tables.length} table(s)` : ''}${tables.length && relationships.length ? ' and ' : ''}${relationships.length ? `${relationships.length} relationship(s)` : ''}`;
    if (dispatch(commands.length === 1 ? commands[0]! : { type: 'batch', label: 'Delete selection', commands }, { silent: false })) {
      toast(label, { action: { label: 'Undo', run: undo } });
    }
  }, []);

  const duplicateSelected = useCallback(() => {
    const { selection, project, dispatch, select, toast } = useStore.getState();
    const id = selection.tables[0];
    if (!id) return;
    const { command, table } = duplicateTableCommand(project, id);
    if (dispatch(command)) { select({ tables: [table.id] }); toast(`Duplicated as ${table.name}`); }
  }, []);

  const autoLayout = useCallback(async () => {
    const { project, selection, dispatch, toast } = useStore.getState();
    const sizes = new Map(rf.getNodes().map((n) => [n.id, { width: n.measured?.width ?? 248, height: n.measured?.height ?? 120 }]));
    const only = selection.tables.length > 1 ? selection.tables : undefined;
    const cmd = await autoLayoutCommand(project, sizes, only);
    if (cmd && dispatch(cmd)) {
      toast(only ? `Arranged ${only.length} selected tables` : 'Auto-layout applied');
      if (!only) setTimeout(() => rf.fitView({ padding: 0.15, duration: 400, maxZoom: 1.1 }), 30);
    }
  }, [rf]);

  const fit = useCallback(() => rf.fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }), [rf]);

  const focusTable = useCallback((id: Id) => {
    const node = rf.getNode(id);
    if (!node) return;
    const w = node.measured?.width ?? 248, h = node.measured?.height ?? 120;
    rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 350 });
    const el = document.querySelector(`.react-flow__node[data-id="${id}"] .tnode`);
    if (el) { el.classList.remove('pulse'); void (el as HTMLElement).offsetWidth; el.classList.add('pulse'); }
  }, [rf]);

  /** Runs the drag-to-link plan: creates the FK directly or asks first when types differ. */
  const connect = useCallback((from: Endpoint, to: Endpoint) => {
    const { project, dispatch, toast, openDialog, closeDialog, select } = useStore.getState();
    const plan = planConnection(project, from, to);
    if (plan.kind === 'error') { toast(plan.message, { kind: 'error' }); return; }
    if (plan.kind === 'ok') {
      if (dispatch(plan.command)) { select({ relationships: [plan.relationship.id] }); toast(plan.message); }
      return;
    }
    openDialog({
      title: plan.title,
      message: plan.message,
      actions: [
        { label: 'Cancel', run: closeDialog },
        ...(plan.secondary ? [{ label: plan.secondary.label, run: () => { closeDialog(); if (dispatch(plan.secondary!.command)) select({ relationships: [plan.relationship.id] }); } }] : []),
        { label: plan.primary.label, variant: 'primary' as const, run: () => { closeDialog(); if (dispatch(plan.primary.command)) { select({ relationships: [plan.relationship.id] }); toast('Relationship created'); } } },
      ],
    });
  }, []);

  const newProject = useCallback(() => {
    const { project, openDialog, closeDialog, loadProject } = useStore.getState();
    const replace = () => { closeDialog(); loadProject(createEmptyProject(), 'Started a new project'); };
    if (!project.model.tables.length) return replace();
    openDialog({
      title: 'Start a new project?',
      message: `"${project.name}" will be replaced. It is not kept anywhere else unless you saved it as a file.`,
      actions: [
        { label: 'Cancel', run: closeDialog },
        { label: 'Save first', run: () => { saveProjectFile(project); replace(); } },
        { label: 'Start new', variant: 'danger', run: replace },
      ],
    });
  }, []);

  const loadSample = useCallback(() => {
    const { project, openDialog, closeDialog, loadProject } = useStore.getState();
    const load = () => { closeDialog(); loadProject(createSampleProject(), 'Opened the e-commerce sample'); };
    if (!project.model.tables.length) return load();
    openDialog({
      title: 'Open the sample project?',
      message: `"${project.name}" will be replaced by the e-commerce sample.`,
      actions: [{ label: 'Cancel', run: closeDialog }, { label: 'Save first', run: () => { saveProjectFile(project); load(); } }, { label: 'Open sample', variant: 'primary', run: load }],
    });
  }, []);

  const openFile = useCallback(async () => {
    const { loadProject, toast } = useStore.getState();
    try {
      const r = await openProjectFile();
      if (!r) return;
      loadProject(r.project, `Opened ${r.fileName}${r.warnings.length ? ` (${r.warnings.length} issue(s) repaired)` : ''}`);
      if (r.warnings.length) console.warn('Repaired while opening:', r.warnings);
    } catch (e) {
      toast(`Could not open the file: ${(e as Error).message}`, { kind: 'error' });
    }
  }, []);

  const saveFile = useCallback(() => {
    const { project, toast } = useStore.getState();
    saveProjectFile(project);
    toast(`Saved ${project.name}.erd.json`);
  }, []);

  const showLinkHint = useCallback(() => {
    const { setLinkHint, toast } = useStore.getState();
    setLinkHint(true);
    toast('Drag from a column’s ● handle onto a column in another table (or onto the table itself)');
    setTimeout(() => useStore.getState().setLinkHint(false), 6000);
  }, []);

  return { addTable, addTableAt, deleteSelection, duplicateSelected, autoLayout, fit, focusTable, connect, newProject, loadSample, openFile, saveFile, showLinkHint, viewCenter };
}
