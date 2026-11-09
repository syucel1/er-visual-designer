import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { addColumnCommand, formatType, type Id, type Table } from '@erd/model';
import { useStore } from '../store/store';

export type TableNodeData = {
  table: Table;
  fkColumnIds: Id[];
  focusColumn?: Id;
};
export type TableNodeType = Node<TableNodeData, 'table'>;

/** A table card: gradient header, one row per column with connection handles on both sides (design §9.5). */
function TableNodeImpl({ id, data }: NodeProps<TableNodeType>) {
  const { table, fkColumnIds, focusColumn } = data;
  const pk = new Set(table.primaryKey?.columnIds ?? []);
  const fk = new Set(fkColumnIds);
  const [editing, setEditing] = useState<null | 'table' | Id>(null);

  const commitTable = (name: string) => {
    setEditing(null);
    if (name.trim() && name !== table.name) useStore.getState().dispatch({ type: 'updateTable', tableId: id, patch: { name: name.trim() } });
  };
  const commitColumn = (colId: Id, name: string) => {
    setEditing(null);
    const col = table.columns.find((c) => c.id === colId);
    if (col && name.trim() && name !== col.name) useStore.getState().dispatch({ type: 'updateColumn', tableId: id, columnId: colId, patch: { name: name.trim() } });
  };
  const addColumn = () => {
    const s = useStore.getState();
    const { command, column } = addColumnCommand(s.project, id);
    if (s.dispatch(command)) { s.select({ tables: [id], focusColumn: column.id }); setEditing(column.id); }
  };

  return (
    <div className="tnode" data-testid={`table-${table.name}`}>
      <div className={`tnode-head head-${table.color ?? 'sunrise'}`} onDoubleClick={() => setEditing('table')} title="Drag to move · double-click to rename">
        <span aria-hidden>▦</span>
        {editing === 'table'
          ? <InlineInput className="tnode-title-input" value={table.name} onDone={commitTable} onCancel={() => setEditing(null)} label="Table name" />
          : <span className="tnode-title">{table.schema ? <span className="opacity-75 font-normal">{table.schema}.</span> : null}{table.name}</span>}
      </div>
      <div className="tnode-body">
        {table.columns.map((c) => (
          <div
            key={c.id}
            className={`crow${focusColumn === c.id ? ' focused' : ''}`}
            data-column={c.id}
            onClick={() => useStore.getState().select({ tables: [id], focusColumn: c.id })}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(c.id); }}
          >
            <Handle type="source" position={Position.Left} id={`${c.id}:l`} title="Drag to another column to create a foreign key" />
            <span className={`ckey ${pk.has(c.id) ? 'pk' : fk.has(c.id) ? 'fk' : ''}`}>{pk.has(c.id) ? 'PK' : fk.has(c.id) ? 'FK' : ''}</span>
            {editing === c.id
              ? <InlineInput className="cname-input nodrag" value={c.name} onDone={(v) => commitColumn(c.id, v)} onCancel={() => setEditing(null)} label="Column name" />
              : <span className="cname" title={c.comment || undefined}>{c.name}{c.nullable && !pk.has(c.id) ? <span className="opt" title="nullable">?</span> : null}</span>}
            <span className="ctype">{formatType(c.type)}{c.identity ? ' ⁺' : ''}</span>
            <Handle type="source" position={Position.Right} id={`${c.id}:r`} title="Drag to another column to create a foreign key" />
          </div>
        ))}
        {!table.columns.length && <div className="px-3 py-2 text-xs text-muted">No columns yet</div>}
      </div>
      <button className="tnode-add nodrag" onClick={addColumn}>＋ column</button>
    </div>
  );
}

function InlineInput({ value, onDone, onCancel, className, label }: { value: string; onDone: (v: string) => void; onCancel: () => void; className: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(value);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      aria-label={label}
      className={`${className} nodrag`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onDone(v); if (e.key === 'Escape') onCancel(); }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export const TableNode = memo(TableNodeImpl);
