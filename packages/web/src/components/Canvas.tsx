import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background, BackgroundVariant, ConnectionMode, Controls, MiniMap, ReactFlow, useEdgesState, useNodesState, useReactFlow,
  type FinalConnectionState, type IsValidConnection, type OnSelectionChangeParams,
} from '@xyflow/react';
import { cardinality, relationshipDisplayName, type Id } from '@erd/model';
import { useStore } from '../store/store';
import { useActions } from '../lib/actions';
import { TableNode, type TableNodeType } from './TableNode';
import { RelationshipEdge, type RelationshipEdgeType } from './RelationshipEdge';
import { EmptyState } from './EmptyState';

const nodeTypes = { table: TableNode };
const edgeTypes = { relationship: RelationshipEdge };
const EMPTY: Id[] = [];
const HEADER_COLORS: Record<string, string> = { sunrise: '#d6246e', violet: '#6d3ff0', blue: '#1d4ed8', teal: '#0f766e', green: '#047857', amber: '#b45309', slate: '#475569' };
const sameArr = (a: Id[], b: Id[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const PALETTE_MIME = 'application/x-erd-palette';

export function Canvas() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const fitRequest = useStore((s) => s.fitRequest);
  const focusRequest = useStore((s) => s.focusRequest);
  const linkHint = useStore((s) => s.linkHint);
  const rf = useReactFlow();
  const actions = useActions();
  const wrapper = useRef<HTMLDivElement>(null);
  const { tables, relationships } = project.model;
  const positions = project.layout.positions;

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationshipEdgeType>([]);

  const fkByTable = useMemo(() => {
    const m = new Map<Id, Id[]>();
    for (const r of relationships) m.set(r.childTableId, [...(m.get(r.childTableId) ?? []), ...r.columns.map((p) => p.child)]);
    return m;
  }, [relationships]);

  // Model → React Flow nodes (keeping measured sizes; unchanged nodes keep their identity).
  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      return tables.map((t) => {
        const p = prevMap.get(t.id);
        const pos = positions[t.id] ?? { x: 0, y: 0 };
        const sel = selection.tables.includes(t.id);
        const fk = fkByTable.get(t.id) ?? EMPTY;
        const focusColumn = sel && selection.tables.length === 1 ? selection.focusColumn : undefined;
        if (p && p.data.table === t && p.position.x === pos.x && p.position.y === pos.y && !!p.selected === sel && sameArr(p.data.fkColumnIds, fk) && p.data.focusColumn === focusColumn) return p;
        return { ...(p ?? {}), id: t.id, type: 'table' as const, position: pos, selected: sel, data: { table: t, fkColumnIds: fk, focusColumn }, dragHandle: '.tnode-head' };
      });
    });
  }, [tables, positions, selection, fkByTable, setNodes]);

  useEffect(() => {
    setEdges(relationships.map((r) => {
      const card = cardinality(project, r);
      const first = r.columns[0]!;
      return {
        id: r.id, type: 'relationship' as const, source: r.childTableId, target: r.parentTableId,
        sourceHandle: `${first.child}:r`, targetHandle: `${first.parent}:l`,
        selected: selection.relationships.includes(r.id),
        data: { childColumnId: first.child, parentColumnId: first.parent, childOptional: card.childOptional, oneToOne: card.oneToOne, label: relationshipDisplayName(r, project.model) },
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationships, tables, selection.relationships, setEdges]);

  // Restore the saved viewport, or fit, whenever a project is loaded.
  useEffect(() => {
    if (!fitRequest) return;
    const v = useStore.getState().project.layout.viewport;
    const t = setTimeout(() => (v ? rf.setViewport(v) : rf.fitView({ padding: 0.15, maxZoom: 1.1 })), 60);
    return () => clearTimeout(t);
  }, [fitRequest, rf]);

  useEffect(() => { if (focusRequest) setTimeout(() => actions.focusTable(focusRequest.id), 40); }, [focusRequest, actions]);

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    useStore.getState().setSelectionFromCanvas(ns.map((n) => n.id), es.map((e) => e.id));
  }, []);

  const onNodeDragStop = useCallback((_: unknown, __: unknown, dragged: TableNodeType[]) => {
    const { project: p, dispatch } = useStore.getState();
    const moves = dragged
      .filter((n) => { const cur = p.layout.positions[n.id]; return !cur || cur.x !== Math.round(n.position.x) || cur.y !== Math.round(n.position.y); })
      .map((n) => ({ tableId: n.id, to: { x: n.position.x, y: n.position.y } }));
    if (moves.length) dispatch({ type: 'moveTables', moves });
  }, []);

  const isValidConnection: IsValidConnection = useCallback((c) => (c.sourceHandle ?? '').split(':')[0] !== (c.targetHandle ?? '').split(':')[0], []);

  // Every drag from a column handle ends here: onto a column (FK between columns) or onto a table header/body.
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (!state.fromHandle?.id || !state.fromNode) return;
    const fromCol = state.fromHandle.id.split(':')[0]!;
    const from = { tableId: state.fromNode.id, columnId: fromCol };
    if (state.toHandle?.id && state.toNode) {
      const toCol = state.toHandle.id.split(':')[0]!;
      if (toCol === fromCol) return;
      actions.connect(from, { tableId: state.toNode.id, columnId: toCol });
      return;
    }
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!pt) return;
    const el = document.elementFromPoint(pt.clientX, pt.clientY);
    const nodeEl = el?.closest<HTMLElement>('.react-flow__node');
    if (!nodeEl?.dataset.id) return;
    const rowEl = el?.closest<HTMLElement>('.crow');
    const tableId = nodeEl.dataset.id;
    if (rowEl?.dataset.column) {
      if (rowEl.dataset.column !== fromCol) actions.connect(from, { tableId, columnId: rowEl.dataset.column });
    } else if (tableId !== from.tableId) {
      actions.connect(from, { tableId });
    }
  }, [actions]);

  const onDrop = useCallback((e: React.DragEvent) => {
    const kind = e.dataTransfer.getData(PALETTE_MIME);
    wrapper.current?.querySelector('.react-flow__pane')?.classList.remove('dragging-over');
    if (!kind) return;
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (kind === 'table') actions.addTableAt({ x: pos.x - 124, y: pos.y - 18 });
    else if (kind === 'relationship') actions.showLinkHint();
  }, [rf, actions]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PALETTE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wrapper.current?.querySelector('.react-flow__pane')?.classList.add('dragging-over');
  }, []);

  const savedViewport = project.layout.viewport;

  return (
    <div ref={wrapper} className={`relative h-full w-full${linkHint ? ' link-hint' : ''}`} onDrop={onDrop} onDragOver={onDragOver} onDragLeave={() => wrapper.current?.querySelector('.react-flow__pane')?.classList.remove('dragging-over')} data-testid="canvas"
      onDoubleClick={(e) => { if ((e.target as HTMLElement).classList.contains('react-flow__pane')) { const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); actions.addTableAt({ x: pos.x - 124, y: pos.y - 18 }); } }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onMoveEnd={(_, v) => useStore.getState().setViewport(v)}
        onPaneClick={() => useStore.getState().setLeftOpen(false)}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={24}
        defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        snapToGrid
        snapGrid={[8, 8]}
        deleteKeyCode={null}
        disableKeyboardA11y
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        onlyRenderVisibleElements={tables.length > 60}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#d9ddea" />
        <MiniMap className="hide-sm" pannable zoomable nodeColor={(n) => HEADER_COLORS[(n.data as { table?: { color?: string } }).table?.color ?? 'sunrise'] ?? '#d6246e'} nodeBorderRadius={6} maskColor="rgba(244,245,250,.7)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      {!tables.length && <EmptyState />}
      <div className="absolute left-14 bottom-4 text-[11px] text-muted bg-white/90 border border-line rounded-full px-3 py-1 hide-sm pointer-events-none">
        Drag a header to move · drag a column’s ● onto another column to link · Shift-drag to select several
      </div>
    </div>
  );
}
