import { describe, expect, it } from 'vitest';
import {
  createEmptyProject, createSampleProject, dispatch, emptyHistory, parseProject, planConnection, serializeProject,
  undo, cardinality, ProjectFormatError, HISTORY_LIMIT, FORMAT_VERSION, singular, uniqueName, type Project, type ConnectionPlan,
} from '../src';

const okCommand = (plan: ConnectionPlan) => { if (plan.kind !== 'ok') throw new Error(`expected ok, got ${plan.kind}`); return plan.command; };

const t = (p: Project, n: string) => p.model.tables.find((x) => x.name === n)!;
const c = (p: Project, tn: string, cn: string) => t(p, tn).columns.find((x) => x.name === cn)!;

describe('history', () => {
  it('coalesces continuous typing in one field into one undo step', () => {
    let p = createSampleProject(), h = emptyHistory();
    const orders = t(p, 'orders');
    const original = orders.name;
    for (const [i, name] of ['o', 'or', 'ord', 'orde'].entries()) {
      ({ project: p, history: h } = dispatch(p, h, { type: 'updateTable', tableId: orders.id, patch: { name } }, { coalesceKey: 'name', now: 1000 + i * 300 }));
    }
    expect(h.past).toHaveLength(1);
    // After a pause a new step starts.
    ({ project: p, history: h } = dispatch(p, h, { type: 'updateTable', tableId: orders.id, patch: { name: 'order' } }, { coalesceKey: 'name', now: 5000 }));
    expect(h.past).toHaveLength(2);
    ({ project: p, history: h } = undo(p, h)!);
    expect(t(p, 'orde')).toBeTruthy();
    ({ project: p, history: h } = undo(p, h)!);
    expect(p.model.tables[1]!.name).toBe(original);
  });

  it('caps history length and clears redo on a new change', () => {
    let p = createEmptyProject(), h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) ({ project: p, history: h } = dispatch(p, h, { type: 'renameProject', name: `n${i}` }));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    ({ project: p, history: h } = undo(p, h)!);
    expect(h.future).toHaveLength(1);
    ({ project: p, history: h } = dispatch(p, h, { type: 'renameProject', name: 'z' }));
    expect(h.future).toHaveLength(0);
  });

  it('no-op commands are not recorded', () => {
    const p = createSampleProject();
    const r = dispatch(p, emptyHistory(), { type: 'renameProject', name: p.name });
    expect(r.history.past).toHaveLength(0);
  });
});

describe('planConnection (drag to create FK)', () => {
  const p = createSampleProject();

  it('column → PK column of same type creates the FK directly, child is the non-key side', () => {
    const q: Project = JSON.parse(JSON.stringify(p));
    q.model.relationships = [];
    const plan = planConnection(q, { tableId: t(q, 'orders').id, columnId: c(q, 'orders', 'customer_id').id }, { tableId: t(q, 'customers').id, columnId: c(q, 'customers', 'id').id });
    expect(plan.kind).toBe('ok');
    if (plan.kind === 'ok') expect(plan.relationship).toMatchObject({ childTableId: t(q, 'orders').id, parentTableId: t(q, 'customers').id });
    // Dragging the other way round gives the same direction.
    const rev = planConnection(q, { tableId: t(q, 'customers').id, columnId: c(q, 'customers', 'id').id }, { tableId: t(q, 'orders').id, columnId: c(q, 'orders', 'customer_id').id });
    expect(rev.kind === 'ok' && rev.relationship.childTableId).toBe(t(q, 'orders').id);
  });

  it('type mismatch asks for confirmation, offering to change the FK type', () => {
    const plan = planConnection(p, { tableId: t(p, 'orders').id, columnId: c(p, 'orders', 'status').id }, { tableId: t(p, 'products').id, columnId: c(p, 'products', 'id').id });
    expect(plan.kind).toBe('confirm');
    if (plan.kind === 'confirm') {
      expect(plan.primary.label).toMatch(/Change status to bigint/);
      const r = dispatch(p, emptyHistory(), plan.primary.command);
      expect(c(r.project, 'orders', 'status').type.name).toBe('bigint');
      expect(r.project.model.relationships).toHaveLength(4);
    }
  });

  it('PK column dropped on a table creates typed FK column(s), composite PKs included', () => {
    const plan = planConnection(p, { tableId: t(p, 'customers').id, columnId: c(p, 'customers', 'id').id }, { tableId: t(p, 'products').id });
    expect(plan.kind).toBe('ok');
    const r = dispatch(p, emptyHistory(), okCommand(plan));
    expect(c(r.project, 'products', 'customer_id')).toMatchObject({ type: { name: 'bigint' }, nullable: false });
    const comp = planConnection(p, { tableId: t(p, 'order_items').id, columnId: c(p, 'order_items', 'order_id').id }, { tableId: t(p, 'customers').id });
    const r2 = dispatch(p, emptyHistory(), okCommand(comp));
    const rel = r2.project.model.relationships.at(-1)!;
    expect(rel.columns).toHaveLength(2);
    expect(t(r2.project, 'customers').columns.map((x) => x.name)).toEqual(expect.arrayContaining(['order_item_order_id', 'order_item_product_id']));
  });

  it('non-key column dropped on a table links to that table\'s PK; errors are reported', () => {
    const q: Project = JSON.parse(JSON.stringify(p));
    q.model.relationships = [];
    const plan = planConnection(q, { tableId: t(q, 'orders').id, columnId: c(q, 'orders', 'customer_id').id }, { tableId: t(q, 'customers').id });
    expect(plan.kind).toBe('ok');
    expect(planConnection(p, { tableId: t(p, 'orders').id, columnId: c(p, 'orders', 'customer_id').id }, { tableId: t(p, 'customers').id }).kind).toBe('error'); // already exists
    expect(planConnection(p, { tableId: t(p, 'orders').id, columnId: c(p, 'orders', 'total').id }, { tableId: t(p, 'order_items').id })).toMatchObject({ kind: 'error', message: expect.stringMatching(/composite/) });
  });

  it('cardinality: optional when FK nullable, 1:1 when FK equals child PK', () => {
    const rel = p.model.relationships[0]!;
    expect(cardinality(p, rel)).toEqual({ childOptional: false, oneToOne: false });
  });
});

describe('project file format', () => {
  it('round-trips through JSON', () => {
    const p = createSampleProject();
    const { project, warnings } = parseProject(serializeProject(p));
    expect(warnings).toEqual([]);
    expect(project).toEqual(JSON.parse(JSON.stringify(p)));
  });

  it('rejects bad files with clear messages', () => {
    expect(() => parseProject('{nope')).toThrow(ProjectFormatError);
    expect(() => parseProject({})).toThrow(/formatVersion/);
    expect(() => parseProject({ formatVersion: FORMAT_VERSION + 1, model: { tables: [] } })).toThrow(/newer version/);
    expect(() => parseProject({ formatVersion: 1, model: { tables: [{ id: 't', name: 'x', columns: [{ id: 'c', name: 'a', type: { name: 'nvarchar2' } }] }] } })).toThrow(/unknown type/);
  });

  it('repairs dangling references and missing positions with warnings', () => {
    const p = JSON.parse(serializeProject(createSampleProject()));
    p.model.relationships.push({ id: 'r_bad', childTableId: 'gone', parentTableId: 'gone', columns: [], onDelete: 'x', onUpdate: 'y' });
    delete p.layout.positions[p.model.tables[0].id];
    const { project, warnings } = parseProject(p);
    expect(project.model.relationships).toHaveLength(3);
    expect(warnings.length).toBe(2);
    expect(project.layout.positions[project.model.tables[0]!.id]).toBeDefined();
  });
});

describe('naming', () => {
  it('singular and uniqueName', () => {
    expect(['customers', 'categories', 'boxes', 'status', 'address'].map(singular)).toEqual(['customer', 'category', 'box', 'status', 'address']);
    expect(uniqueName('table', ['table', 'TABLE_2'])).toBe('table_3');
  });
});
