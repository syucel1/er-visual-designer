import type { Command, Id, Project } from '@erd/model';
import type { ELK } from 'elkjs/lib/elk-api';

// ELK is large (~1.4 MB), so it is loaded only the first time auto-layout is used.
let elkPromise: Promise<ELK> | undefined;
const getElk = () => (elkPromise ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default() as ELK));

/**
 * Layered auto-layout with ELK (design §3.3): parents to the left of children.
 * `sizes` are the measured node sizes from the canvas; returns one moveTables command (one undo step).
 */
export async function autoLayoutCommand(project: Project, sizes: Map<Id, { width: number; height: number }>, onlyIds?: Id[]): Promise<Command | null> {
  const ids = new Set(onlyIds?.length ? onlyIds : project.model.tables.map((t) => t.id));
  const tables = project.model.tables.filter((t) => ids.has(t.id));
  if (!tables.length) return null;
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '50',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '70',
    },
    children: tables.map((t) => {
      const s = sizes.get(t.id);
      return { id: t.id, width: s?.width ?? 248, height: s?.height ?? 40 + t.columns.length * 24 };
    }),
    // Parent → child so that referenced tables come first (left).
    edges: project.model.relationships
      .filter((r) => ids.has(r.childTableId) && ids.has(r.parentTableId) && r.childTableId !== r.parentTableId)
      .map((r) => ({ id: r.id, sources: [r.parentTableId], targets: [r.childTableId] })),
  };
  const res = await (await getElk()).layout(graph);
  // Keep the laid-out group where the selection was (or at the origin for the whole model).
  const origin = onlyIds?.length
    ? tables.reduce((o, t) => { const p = project.layout.positions[t.id] ?? { x: 0, y: 0 }; return { x: Math.min(o.x, p.x), y: Math.min(o.y, p.y) }; }, { x: Infinity, y: Infinity })
    : { x: 40, y: 40 };
  return {
    type: 'moveTables',
    moves: (res.children ?? []).map((n) => ({ tableId: n.id, to: { x: origin.x + (n.x ?? 0), y: origin.y + (n.y ?? 0) } })),
  };
}
