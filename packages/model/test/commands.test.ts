import { describe, expect, it } from 'vitest';
import {
  addColumnCommand, addTableCommand, createSampleProject, dispatch, duplicateTableCommand, emptyHistory, execute,
  makeColumn, newRelationship, redo, togglePrimaryKeyCommand, undo, CommandError, type Command, type Project,
} from '../src';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const tableByName = (p: Project, n: string) => p.model.tables.find((t) => t.name === n)!;
const colId = (p: Project, t: string, c: string) => tableByName(p, t).columns.find((x) => x.name === c)!.id;

/** Applies a command, then undoes it, and checks the project is exactly as before. */
function roundTrip(p: Project, cmd: Command) {
  const before = clone(p);
  const h = emptyHistory();
  const r = dispatch(p, h, cmd);
  const u = undo(r.project, r.history)!;
  expect(clone(u.project)).toEqual(before);
  const again = redo(u.project, u.history)!;
  expect(clone(again.project)).toEqual(clone(r.project));
  return r.project;
}

describe('commands (apply + undo + redo)', () => {
  const p = createSampleProject();
  const orders = tableByName(p, 'orders');

  it('addTable', () => {
    const { command, table } = addTableCommand(p, { x: 10, y: 20 });
    const next = roundTrip(p, command);
    expect(next.model.tables.find((t) => t.id === table.id)?.name).toBe('table');
    expect(next.layout.positions[table.id]).toEqual({ x: 10, y: 20 });
  });

  it('removeTables also removes relationships and positions', () => {
    const next = roundTrip(p, { type: 'removeTables', tableIds: [orders.id] });
    expect(next.model.tables.some((t) => t.id === orders.id)).toBe(false);
    expect(next.model.relationships.some((r) => r.childTableId === orders.id || r.parentTableId === orders.id)).toBe(false);
    expect(next.layout.positions[orders.id]).toBeUndefined();
  });

  it('updateTable / renameProject', () => {
    expect(roundTrip(p, { type: 'updateTable', tableId: orders.id, patch: { name: 'purchase', color: 'teal' } }).model.tables[1]!.name).toBe('purchase');
    expect(roundTrip(p, { type: 'renameProject', name: 'x' }).name).toBe('x');
  });

  it('addColumn / updateColumn / moveColumn / removeColumn', () => {
    const { command, column } = addColumnCommand(p, orders.id, 1);
    let next = roundTrip(p, command);
    expect(tableByName(next, 'orders').columns[1]!.id).toBe(column.id);
    next = roundTrip(p, { type: 'updateColumn', tableId: orders.id, columnId: colId(p, 'orders', 'total'), patch: { nullable: false, default: { kind: 'literal', value: '0' } } });
    expect(tableByName(next, 'orders').columns.find((c) => c.name === 'total')).toMatchObject({ nullable: false, default: { value: '0' } });
    next = roundTrip(p, { type: 'updateColumn', tableId: orders.id, columnId: colId(p, 'orders', 'status'), patch: { default: undefined } });
    expect(tableByName(next, 'orders').columns.find((c) => c.name === 'status')!.default).toBeUndefined();
    next = roundTrip(p, { type: 'moveColumn', tableId: orders.id, columnId: colId(p, 'orders', 'placed_at'), toIndex: 0 });
    expect(tableByName(next, 'orders').columns[0]!.name).toBe('placed_at');
  });

  it('removing a column drops it from the PK and from relationships', () => {
    const next = roundTrip(p, { type: 'removeColumn', tableId: orders.id, columnId: colId(p, 'orders', 'id') });
    expect(tableByName(next, 'orders').primaryKey).toBeUndefined();
    expect(next.model.relationships.some((r) => r.parentTableId === orders.id)).toBe(false);
  });

  it('setPrimaryKey makes columns NOT NULL; toggle adds/removes', () => {
    const items = tableByName(p, 'order_items');
    const total = colId(p, 'orders', 'total');
    const next = roundTrip(p, togglePrimaryKeyCommand(p, orders.id, total));
    const o = tableByName(next, 'orders');
    expect(o.primaryKey!.columnIds).toEqual([colId(p, 'orders', 'id'), total]);
    expect(o.columns.find((c) => c.id === total)!.nullable).toBe(false);
    const removed = roundTrip(p, togglePrimaryKeyCommand(p, items.id, colId(p, 'order_items', 'order_id')));
    expect(tableByName(removed, 'order_items').primaryKey!.columnIds).toEqual([colId(p, 'order_items', 'product_id')]);
  });

  it('create / update / remove relationships', () => {
    const rel = newRelationship(orders.id, orders.id, [{ child: colId(p, 'orders', 'customer_id'), parent: colId(p, 'orders', 'id') }]);
    let next = roundTrip(p, { type: 'createRelationship', relationship: rel });
    expect(next.model.relationships).toHaveLength(4);
    next = roundTrip(p, { type: 'updateRelationship', relationshipId: p.model.relationships[0]!.id, patch: { onDelete: 'cascade', name: 'fk_x' } });
    expect(next.model.relationships[0]).toMatchObject({ onDelete: 'cascade', name: 'fk_x' });
    next = roundTrip(p, { type: 'removeRelationships', relationshipIds: [p.model.relationships[0]!.id] });
    expect(next.model.relationships).toHaveLength(2);
  });

  it('moveTables and batch undo in one step', () => {
    const cmd: Command = { type: 'batch', label: 'x', commands: [
      { type: 'moveTables', moves: p.model.tables.map((t) => ({ tableId: t.id, to: { x: 1, y: 2 } })) },
      { type: 'updateTable', tableId: orders.id, patch: { name: 'o' } },
    ] };
    const next = roundTrip(p, cmd);
    expect(Object.values(next.layout.positions).every((v) => v.x === 1 && v.y === 2)).toBe(true);
  });

  it('duplicateTable gives new ids and a unique name', () => {
    const { command, table } = duplicateTableCommand(p, orders.id);
    const next = roundTrip(p, command);
    expect(table.name).toBe('orders_copy');
    expect(table.columns.every((c) => !orders.columns.some((o) => o.id === c.id))).toBe(true);
    expect(table.primaryKey!.columnIds[0]).toBe(table.columns[0]!.id);
    expect(next.model.tables).toHaveLength(5);
  });

  it('rejects invalid commands without changing the project', () => {
    expect(() => execute(p, { type: 'updateTable', tableId: 'nope', patch: { name: 'x' } })).toThrow(CommandError);
    const dup = { ...p.model.relationships[0]!, id: 'r_new' };
    expect(() => execute(p, { type: 'createRelationship', relationship: dup })).toThrow(/already exists/);
    const self = newRelationship(orders.id, orders.id, [{ child: colId(p, 'orders', 'id'), parent: colId(p, 'orders', 'id') }]);
    expect(() => execute(p, { type: 'createRelationship', relationship: self })).toThrow(/itself/);
    expect(() => execute(p, { type: 'addColumn', tableId: orders.id, column: { ...makeColumn('x'), id: orders.columns[0]!.id } })).toThrow(/already exists/);
  });
});

describe('random command sequences undo back to the start', () => {
  it('200 random edits fully undo and redo', () => {
    let seed = 42;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const start = createSampleProject();
    let p = start, h = emptyHistory();
    const snapshots: Project[] = [];
    for (let i = 0; i < 200; i++) {
      const tables = p.model.tables;
      const t = tables.length ? tables[rnd(tables.length)]! : undefined;
      let cmd: Command;
      const k = rnd(8);
      if (!t || k === 0) cmd = addTableCommand(p, { x: rnd(800), y: rnd(600) }).command;
      else if (k === 1) cmd = addColumnCommand(p, t.id).command;
      else if (k === 2 && t.columns.length) cmd = { type: 'updateColumn', tableId: t.id, columnId: t.columns[rnd(t.columns.length)]!.id, patch: { nullable: rnd(2) === 0, name: `c${i}` } };
      else if (k === 3 && t.columns.length > 1) cmd = { type: 'removeColumn', tableId: t.id, columnId: t.columns[rnd(t.columns.length)]!.id };
      else if (k === 4) cmd = { type: 'moveTables', moves: [{ tableId: t.id, to: { x: rnd(900), y: rnd(900) } }] };
      else if (k === 5 && tables.length > 2) cmd = { type: 'removeTables', tableIds: [t.id] };
      else if (k === 6 && t.columns.length) cmd = togglePrimaryKeyCommand(p, t.id, t.columns[rnd(t.columns.length)]!.id);
      else cmd = { type: 'updateTable', tableId: t.id, patch: { name: `t${i}` } };
      snapshots.push(clone(p));
      const r = dispatch(p, h, cmd, { now: i * 10_000 });
      p = r.project; h = r.history;
    }
    const end = clone(p);
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const u = undo(p, h)!;
      p = u.project; h = u.history;
      expect(clone(p)).toEqual(snapshots[i]);
    }
    expect(clone(p)).toEqual(clone(start));
    while (h.future.length) { const r = redo(p, h)!; p = r.project; h = r.history; }
    expect(clone(p)).toEqual(end);
  });
});
