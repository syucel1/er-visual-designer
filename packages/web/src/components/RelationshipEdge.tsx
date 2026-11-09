import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react';

export type RelationshipEdgeData = {
  childColumnId: string;
  parentColumnId: string;
  childOptional: boolean;
  oneToOne: boolean;
  label: string;
};
export type RelationshipEdgeType = Edge<RelationshipEdgeData, 'relationship'>;

interface Anchor { x: number; y: number; dir: 1 | -1 }

/** Absolute centre of a column handle on the given side (`l` / `r`). */
function handleAnchor(node: InternalNode, columnId: string, side: 'l' | 'r'): Anchor | null {
  const handles = node.internals.handleBounds?.source ?? [];
  const h = handles.find((x) => x.id === `${columnId}:${side}`);
  if (!h) return null;
  const p = node.internals.positionAbsolute;
  return { x: p.x + h.x + h.width / 2, y: p.y + h.y + h.height / 2, dir: side === 'r' ? 1 : -1 };
}

/**
 * "Floating" relationship edge: picks the left/right column handles that face each other, so the line
 * re-routes live while tables are dragged. Crow's foot (many) at the child end, bar (one) at the parent end,
 * circle when the FK is optional (design §9.5).
 */
function RelationshipEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelationshipEdgeType>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !data) return null;

  let a: Anchor | null, b: Anchor | null;
  if (source === target) {
    a = handleAnchor(s, data.childColumnId, 'r');
    b = handleAnchor(t, data.parentColumnId, 'r');
  } else {
    const sw = s.measured.width ?? 248, tw = t.measured.width ?? 248;
    const sCenter = s.internals.positionAbsolute.x + sw / 2, tCenter = t.internals.positionAbsolute.x + tw / 2;
    const overlap = Math.abs(sCenter - tCenter) < (sw + tw) / 2 - 20;
    if (overlap) { a = handleAnchor(s, data.childColumnId, 'r'); b = handleAnchor(t, data.parentColumnId, 'r'); }
    else if (sCenter < tCenter) { a = handleAnchor(s, data.childColumnId, 'r'); b = handleAnchor(t, data.parentColumnId, 'l'); }
    else { a = handleAnchor(s, data.childColumnId, 'l'); b = handleAnchor(t, data.parentColumnId, 'r'); }
  }
  if (!a || !b) return null;

  const k = Math.max(40, Math.min(160, Math.abs(b.x - a.x) / 2 + (a.dir === b.dir ? 40 : 0)));
  const path = `M ${a.x} ${a.y} C ${a.x + a.dir * k} ${a.y}, ${b.x + b.dir * k} ${b.y}, ${b.x} ${b.y}`;

  // Child end: many (crow's foot) unless 1:1; optional → circle, mandatory → bar.
  const cx = a.x, cy = a.y, d = a.dir;
  const childMarks = data.oneToOne
    ? `M ${cx + d * 8} ${cy - 6} L ${cx + d * 8} ${cy + 6}`
    : `M ${cx + d * 13} ${cy} L ${cx} ${cy - 6} M ${cx + d * 13} ${cy} L ${cx} ${cy} M ${cx + d * 13} ${cy} L ${cx} ${cy + 6}`;
  const childMod = data.childOptional
    ? null
    : `M ${cx + d * 18} ${cy - 6} L ${cx + d * 18} ${cy + 6}`;
  // Parent end: exactly one (double bar).
  const px = b.x, py = b.y, e = b.dir;
  const parentMarks = `M ${px + e * 9} ${py - 6} L ${px + e * 9} ${py + 6} M ${px + e * 14} ${py - 6} L ${px + e * 14} ${py + 6}`;

  const mid = { x: (a.x + b.x) / 2 + (a.dir === b.dir ? a.dir * k * 0.75 : 0), y: (a.y + b.y) / 2 };

  return (
    <>
      <BaseEdge id={id} path={path} className="rel-edge" interactionWidth={16} />
      <path d={`${childMarks} ${childMod ?? ''} ${parentMarks}`} className="rel-marker" fill="none" />
      {data.childOptional && <circle cx={cx + d * 20} cy={cy} r={4} className="rel-marker" />}
      {selected && (
        <EdgeLabelRenderer>
          <div className="absolute px-2 py-0.5 rounded-full text-[11px] font-semibold text-white mono pointer-events-none" style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`, background: 'var(--grad-accent)' }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const RelationshipEdge = memo(RelationshipEdgeImpl);
