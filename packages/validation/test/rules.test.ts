import { describe, expect, it } from 'vitest';
import {
  createSampleProject, dispatch, emptyHistory, makeCheck, makeColumn, makeIndex, makeUnique, newRelationship,
  type Command, type EngineTarget, type Project, type Table,
} from '@erd/model';
import { planConversion } from '@erd/dialects';
import { diffModel, validateProject, Validator, type Issue } from '../src';

/** Sample project converted to an engine, then edited with plain commands. */
function project(target: EngineTarget, ...edits: ((p: Project) => Command | Command[])[]): Project {
  let p = createSampleProject();
  p = dispatch(p, emptyHistory(), planConversion(p, target).command).project;
  for (const e of edits) for (const c of [e(p)].flat()) p = dispatch(p, emptyHistory(), c).project;
  return p;
}
const T = (p: Project, n: string) => p.model.tables.find((t) => t.name === n)!;
const C = (p: Project, t: string, c: string) => T(p, t).columns.find((x) => x.name === c)!;
const ids = (issues: Issue[]) => issues.map((i) => i.ruleId);
const has = (p: Project, rule: string) => validateProject(p).filter((i) => i.ruleId === rule);
const upd = (p: Project, t: string, c: string, patch: object): Command => ({ type: 'updateColumn', tableId: T(p, t).id, columnId: C(p, t, c).id, patch });
const PG: EngineTarget = { engine: 'postgresql', version: '16' };
const MY: EngineTarget = { engine: 'mysql', version: '8.4' };
const MS: EngineTarget = { engine: 'sqlserver', version: '2022' };
const ORA: EngineTarget = { engine: 'oracle', version: '23ai' };
const LITE: EngineTarget = { engine: 'sqlite' };

/** Applies the first quick fix of the first issue with `rule` and checks that issue is gone. */
function fixResolves(p: Project, rule: string) {
  const before = has(p, rule);
  expect(before.length, `${rule} should be reported`).toBeGreaterThan(0);
  const fix = before[0]!.fixes[0]!;
  const next = dispatch(p, emptyHistory(), { type: 'batch', label: fix.label, commands: fix.commands }).project;
  expect(has(next, rule).filter((i) => i.key === before[0]!.key), `${rule} after "${fix.label}"`).toHaveLength(0);
}

describe('clean models', () => {
  it.each([PG, MY, MS, ORA, LITE, { engine: 'generic' } as EngineTarget])('the sample is free of errors and warnings on %o', (target) => {
    const issues = validateProject(project(target));
    expect(issues.filter((i) => i.severity !== 'info').map((i) => i.message)).toEqual([]);
  });
});

describe('names', () => {
  it('E-NAM-001 empty names', () => {
    const p = project(PG, (p) => ({ type: 'updateTable', tableId: T(p, 'orders').id, patch: { name: '' } }));
    expect(ids(has(p, 'E-NAM-001'))).toHaveLength(1);
    fixResolves(p, 'E-NAM-001');
  });

  it('E-NAM-002 duplicate column and table names (case-insensitive)', () => {
    let p = project(PG, (p) => upd(p, 'orders', 'status', { name: 'TOTAL' }));
    expect(has(p, 'E-NAM-002')).toHaveLength(1);
    fixResolves(p, 'E-NAM-002');
    p = project(PG, (p) => ({ type: 'updateTable', tableId: T(p, 'products').id, patch: { name: 'Orders' } }));
    expect(has(p, 'E-NAM-002').map((i) => i.message)).toEqual(['Duplicate table name "Orders"']);
  });

  it('E-NAM-003 identifier length per engine (PostgreSQL 63 bytes, MySQL 64 chars, Oracle 128 bytes)', () => {
    const n = (k: number) => 'a'.repeat(k);
    expect(has(project(PG, (p) => upd(p, 'orders', 'status', { name: n(63) })), 'E-NAM-003')).toHaveLength(0);
    expect(has(project(PG, (p) => upd(p, 'orders', 'status', { name: n(64) })), 'E-NAM-003')).toHaveLength(1);
    expect(has(project(MY, (p) => upd(p, 'orders', 'status', { name: n(64) })), 'E-NAM-003')).toHaveLength(0);
    expect(has(project(MY, (p) => upd(p, 'orders', 'status', { name: n(65) })), 'E-NAM-003')).toHaveLength(1);
    expect(has(project(ORA, (p) => upd(p, 'orders', 'status', { name: 'é'.repeat(65) })), 'E-NAM-003')).toHaveLength(1); // 130 bytes
    expect(has(project(LITE, (p) => upd(p, 'orders', 'status', { name: n(300) })), 'E-NAM-003')).toHaveLength(0);
    fixResolves(project(PG, (p) => upd(p, 'orders', 'status', { name: n(80) })), 'E-NAM-003');
  });

  it('E-NAM-004 reserved words differ by engine', () => {
    const p = (t: EngineTarget, name: string) => project(t, (p) => upd(p, 'orders', 'status', { name }));
    expect(has(p(PG, 'user'), 'E-NAM-004')).toHaveLength(1);
    expect(has(p(MY, 'key'), 'E-NAM-004')).toHaveLength(1);
    expect(has(p(PG, 'key'), 'E-NAM-004')).toHaveLength(0);
    expect(has(p(ORA, 'level'), 'E-NAM-004')).toHaveLength(1);
    expect(has(p(MS, 'percent'), 'E-NAM-004')).toHaveLength(1);
    expect(has(project(PG, (p) => ({ type: 'updateTable', tableId: T(p, 'orders').id, patch: { name: 'order' } })), 'E-NAM-004')[0]!.fixes[0]!.label).toBe('Rename to orders');
    fixResolves(p(PG, 'user'), 'E-NAM-004');
  });

  it('W-NAM-005 special characters everywhere; mixed case only where names are folded', () => {
    expect(has(project(MY, (p) => upd(p, 'orders', 'status', { name: 'order status' })), 'W-NAM-005')).toHaveLength(1);
    expect(has(project(PG, (p) => upd(p, 'orders', 'status', { name: 'orderStatus' })), 'W-NAM-005')).toHaveLength(1);
    expect(has(project(MY, (p) => upd(p, 'orders', 'status', { name: 'orderStatus' })), 'W-NAM-005')).toHaveLength(0);
    expect(has(project(ORA, (p) => upd(p, 'orders', 'status', { name: 'STATUS' })), 'W-NAM-005')).toHaveLength(0);
    const fixed = has(project(PG, (p) => upd(p, 'orders', 'status', { name: 'orderStatus' })), 'W-NAM-005')[0]!;
    expect(fixed.fixes[0]!.label).toBe('Rename to order_status');
  });

  it('W-SCH-001 schemas on MySQL / SQLite', () => {
    const edit = (p: Project): Command => ({ type: 'updateTable', tableId: T(p, 'orders').id, patch: { schema: 'sales' } });
    expect(has(project(MY, edit), 'W-SCH-001')).toHaveLength(1);
    expect(has(project(PG, edit), 'W-SCH-001')).toHaveLength(0);
    fixResolves(project(LITE, edit), 'W-SCH-001');
  });

  it('E-NAM-006 duplicate constraint names', () => {
    const p = project(PG,
      (p) => ({ type: 'addTableItem', tableId: T(p, 'orders').id, kind: 'checks', item: { ...makeCheck('total >= 0'), name: 'ck_positive' } }),
      (p) => ({ type: 'addTableItem', tableId: T(p, 'products').id, kind: 'checks', item: { ...makeCheck('price >= 0'), name: 'ck_positive' } }));
    expect(has(p, 'E-NAM-006')).toHaveLength(2);
    fixResolves(p, 'E-NAM-006');
  });
});

describe('tables, keys and identity', () => {
  it('W-TBL-001 / W-PK-002', () => {
    const p = project(PG, (p) => ({ type: 'setPrimaryKey', tableId: T(p, 'orders').id, columnIds: [] }));
    expect(has(p, 'W-PK-002')[0]!.fixes[0]!.label).toBe('Make id the primary key');
    fixResolves(p, 'W-PK-002');
    const empty = project(PG, (p) => ({ type: 'addTable', table: { id: 't_e', name: 'empty', columns: [] }, position: { x: 0, y: 0 } }));
    fixResolves(empty, 'W-TBL-001');
  });

  it('E-PK-001 nullable primary-key column', () => {
    // setPrimaryKey forces NOT NULL, so make it nullable afterwards.
    const p = project(PG, (p) => upd(p, 'orders', 'id', { nullable: true }));
    fixResolves(p, 'E-PK-001');
  });

  it('E-IDN-001 auto-increment on a non-integer type', () => {
    const p = project(MS, (p) => upd(p, 'orders', 'status', { identity: true }));
    expect(has(p, 'E-IDN-001')).toHaveLength(1);
    fixResolves(p, 'E-IDN-001');
  });

  it('E-IDN-002 one identity per table on MySQL / SQL Server / Oracle / SQLite, not PostgreSQL', () => {
    const edit = (p: Project) => upd(p, 'orders', 'customer_id', { identity: true });
    expect(has(project(PG, edit), 'E-IDN-002')).toHaveLength(0);
    for (const t of [MY, MS, ORA]) expect(has(project(t, edit), 'E-IDN-002'), JSON.stringify(t)).toHaveLength(1);
    fixResolves(project(MS, edit), 'E-IDN-002');
  });

  it('E-IDN-003 MySQL AUTO_INCREMENT must lead a key', () => {
    const p = project(MY, (p) => upd(p, 'orders', 'id', { identity: undefined }), (p) => upd(p, 'orders', 'total', { identity: true, type: { name: 'BIGINT', logical: 'bigint' } }));
    expect(has(p, 'E-IDN-003')).toHaveLength(1);
    fixResolves(p, 'E-IDN-003');
  });

  it('E-IDN-004 SQLite AUTOINCREMENT only on a single INTEGER PRIMARY KEY', () => {
    const p = project(LITE, (p) => upd(p, 'order_items', 'order_id', { identity: true }));
    expect(has(p, 'E-IDN-004')).toHaveLength(1);
    expect(has(project(LITE), 'E-IDN-004')).toHaveLength(0);
    fixResolves(p, 'E-IDN-004');
  });
});

describe('types and defaults', () => {
  it('E-TYP-001 type not in the engine or version', () => {
    const p = project(PG, (p) => upd(p, 'orders', 'status', { type: { name: 'NVARCHAR2', length: 20, logical: 'varchar' } }));
    expect(has(p, 'E-TYP-001')[0]!.fixes[0]!.label).toBe('Use varchar(20)');
    fixResolves(p, 'E-TYP-001');
    const ora = project({ engine: 'oracle', version: '19c' }, (p) => upd(p, 'orders', 'status', { type: { name: 'BOOLEAN', logical: 'boolean' } }));
    expect(has(ora, 'E-TYP-001')[0]!.message).toMatch(/not supported by Oracle 19c/);
    fixResolves(ora, 'E-TYP-001');
  });

  it('E-TYP-002 parameters: missing length, out of range, MAX, scale > precision', () => {
    fixResolves(project(MY, (p) => upd(p, 'orders', 'status', { type: { name: 'VARCHAR', logical: 'varchar' } })), 'E-TYP-002');
    expect(has(project(PG, (p) => upd(p, 'orders', 'status', { type: { name: 'varchar', logical: 'varchar' } })), 'E-TYP-002')).toHaveLength(0); // unbounded varchar is fine in PostgreSQL
    const big = project(MS, (p) => upd(p, 'orders', 'status', { type: { name: 'NVARCHAR', length: 5000, logical: 'varchar' } }));
    expect(has(big, 'E-TYP-002')[0]!.fixes[0]!.label).toBe('Use NVARCHAR(MAX)');
    fixResolves(big, 'E-TYP-002');
    fixResolves(project(MS, (p) => upd(p, 'orders', 'total', { type: { name: 'DECIMAL', precision: 40, scale: 2, logical: 'decimal' } })), 'E-TYP-002');
    fixResolves(project(PG, (p) => upd(p, 'orders', 'total', { type: { name: 'numeric', precision: 5, scale: 7, logical: 'decimal' } })), 'E-TYP-002');
    fixResolves(project(PG, (p) => upd(p, 'orders', 'status', { type: { name: 'char', max: true, logical: 'char' } })), 'E-TYP-002');
  });

  it('E-DEF-001 literal defaults must suit the type', () => {
    const bad = (t: string, c: string, value: string) => has(project(PG, (p) => upd(p, t, c, { default: { kind: 'literal', value } })), 'E-DEF-001');
    expect(bad('orders', 'total', 'abc')).toHaveLength(1);
    expect(bad('orders', 'total', '-12.50')).toHaveLength(0);
    expect(bad('order_items', 'quantity', '1.5')).toHaveLength(1);
    expect(bad('orders', 'status', 'anything')).toHaveLength(0);
    fixResolves(project(PG, (p) => upd(p, 'orders', 'total', { default: { kind: 'literal', value: 'abc' } })), 'E-DEF-001');
  });

  it('E-DEF-002 MySQL TEXT/BLOB/JSON cannot have literal defaults', () => {
    const edit = (p: Project) => upd(p, 'orders', 'status', { type: { name: 'TEXT', logical: 'text' }, default: { kind: 'literal', value: 'x' } });
    expect(has(project(MY, edit), 'E-DEF-002')[0]!.fixes[0]!.label).toBe("Use expression ('x')");
    fixResolves(project(MY, edit), 'E-DEF-002');
  });
});

describe('constraints and indexes', () => {
  it('W-CON-002 / W-IDX-002 duplicates, E-CHK-001 / 002 bad checks', () => {
    const p = project(PG,
      (p) => ({ type: 'addTableItem', tableId: T(p, 'orders').id, kind: 'uniques', item: makeUnique([C(p, 'orders', 'id').id]) }),
      (p) => ({ type: 'addTableItem', tableId: T(p, 'orders').id, kind: 'indexes', item: makeIndex([C(p, 'orders', 'customer_id').id]) }),
      (p) => ({ type: 'addTableItem', tableId: T(p, 'orders').id, kind: 'indexes', item: makeIndex([C(p, 'orders', 'customer_id').id]) }),
      (p) => ({ type: 'addTableItem', tableId: T(p, 'orders').id, kind: 'checks', item: makeCheck('') }),
      (p) => ({ type: 'addTableItem', tableId: T(p, 'products').id, kind: 'checks', item: makeCheck("price > (0") }));
    for (const r of ['W-CON-002', 'W-IDX-002', 'E-CHK-001', 'E-CHK-002']) expect(has(p, r), r).toHaveLength(1);
    for (const r of ['W-CON-002', 'W-IDX-002', 'E-CHK-001']) fixResolves(p, r);
  });
});

describe('relationships', () => {
  it('E-FK-002 types: different family = error; different size = warning (error on MySQL)', () => {
    const edit = (type: object) => (p: Project) => upd(p, 'orders', 'customer_id', { type });
    expect(has(project(PG, edit({ name: 'varchar', length: 20, logical: 'varchar' })), 'E-FK-002')[0]!.severity).toBe('error');
    expect(has(project(PG, edit({ name: 'integer', logical: 'integer' })), 'E-FK-002')[0]!.severity).toBe('warning');
    expect(has(project(MY, edit({ name: 'INT', logical: 'integer' })), 'E-FK-002')[0]!.severity).toBe('error');
    fixResolves(project(PG, edit({ name: 'integer', logical: 'integer' })), 'E-FK-002');
  });

  it('E-FK-003 referenced columns must be a key; fix adds a unique constraint', () => {
    const p = project(PG, (p) => ({ type: 'createRelationship', relationship: newRelationship(T(p, 'orders').id, T(p, 'customers').id, [{ child: C(p, 'orders', 'status').id, parent: C(p, 'customers', 'email').id }]) }));
    expect(has(p, 'E-FK-003')).toHaveLength(1);
    fixResolves(p, 'E-FK-003');
  });

  it('W-FK-004 SET NULL on NOT NULL; E-FK-005 unsupported actions per engine', () => {
    const setNull = (p: Project): Command => ({ type: 'updateRelationship', relationshipId: p.model.relationships[0]!.id, patch: { onDelete: 'set_null' } });
    fixResolves(project(PG, setNull), 'W-FK-004');
    const onUpd = (p: Project): Command => ({ type: 'updateRelationship', relationshipId: p.model.relationships[0]!.id, patch: { onUpdate: 'cascade' } });
    expect(has(project(PG, onUpd), 'E-FK-005')).toHaveLength(0);
    fixResolves(project(ORA, onUpd), 'E-FK-005');
    const restrict = (p: Project): Command => ({ type: 'updateRelationship', relationshipId: p.model.relationships[0]!.id, patch: { onDelete: 'restrict' } });
    expect(has(project(MS, restrict), 'E-FK-005')).toHaveLength(1);
  });

  it('I-IDX-001 FK without index (not on MySQL, which creates one itself)', () => {
    expect(has(project(PG), 'I-IDX-001').map((i) => i.message)).toEqual(['orders(customer_id) has a foreign key but no supporting index', 'order_items(product_id) has a foreign key but no supporting index']);
    expect(has(project(MY), 'I-IDX-001')).toHaveLength(0);
    fixResolves(project(PG), 'I-IDX-001');
  });

  it('I-REL-001 circular foreign keys', () => {
    const p = project(PG, (p) => ({ type: 'addColumn', tableId: T(p, 'customers').id, column: makeColumn('last_order_id', { name: 'bigint', logical: 'bigint' }) }),
      (p) => ({ type: 'createRelationship', relationship: newRelationship(T(p, 'customers').id, T(p, 'orders').id, [{ child: C(p, 'customers', 'last_order_id').id, parent: C(p, 'orders', 'id').id }]) }));
    expect(has(p, 'I-REL-001')[0]!.message).toBe('Circular foreign keys between customers, orders');
  });
});

describe('every quick fix is a valid command', () => {
  it('applies cleanly for a model with many problems on every engine', () => {
    for (const target of [PG, MY, MS, ORA, LITE]) {
      const messy = project(target,
        (p) => upd(p, 'orders', 'status', { name: 'order status', identity: true }),
        (p) => upd(p, 'orders', 'total', { default: { kind: 'literal', value: 'x' } }),
        (p) => ({ type: 'updateTable', tableId: T(p, 'products').id, patch: { name: 'user', schema: 's' } }),
        (p) => ({ type: 'updateRelationship', relationshipId: p.model.relationships[0]!.id, patch: { onDelete: 'set_default', onUpdate: 'set_null' } }));
      for (const i of validateProject(messy)) for (const f of i.fixes) {
        expect(() => dispatch(messy, emptyHistory(), { type: 'batch', label: f.label, commands: f.commands }), `${target.engine} ${i.ruleId} ${f.label}`).not.toThrow();
      }
    }
  });
});

describe('incremental validator', () => {
  function big(n: number): Project {
    const p: Project = JSON.parse(JSON.stringify(project(PG)));
    const base = [...p.model.tables];
    for (let i = 0; p.model.tables.length < n; i++) for (const t of base) {
      const copy: Table = JSON.parse(JSON.stringify(t));
      copy.id = `${t.id}_${i}`; copy.name = `${t.name}_${i}`;
      copy.columns.forEach((c) => (c.id = `${c.id}_${i}`));
      copy.primaryKey = { columnIds: copy.primaryKey!.columnIds.map((id) => `${id}_${i}`) };
      p.model.tables.push(copy);
      if (p.model.tables.length >= n) break;
    }
    return p;
  }

  it('gives the same result as a full run after edits', () => {
    const v = new Validator();
    let p = project(PG);
    v.validate(p, 'all');
    const edits: ((p: Project) => Command)[] = [
      (p) => upd(p, 'orders', 'status', { name: 'user' }),
      (p) => ({ type: 'removeTables', tableIds: [T(p, 'products').id] }),
      (p) => upd(p, 'orders', 'customer_id', { type: { name: 'integer', logical: 'integer' } }),
    ];
    for (const e of edits) {
      const next = dispatch(p, emptyHistory(), e(p)).project;
      const inc = v.validate(next, diffModel(p, next));
      expect(inc.mode).toBe('incremental');
      expect(inc.issues.map((i) => i.key)).toEqual(validateProject(next).map((i) => i.key));
      p = next;
    }
  });

  it('meets the budgets: full < 500 ms and incremental < 150 ms for 200 tables', () => {
    const p = big(200);
    const v = new Validator();
    const full = v.validate(p, 'all');
    expect(full.checkedTables).toBe(200);
    expect(full.ms).toBeLessThan(500);
    const next = dispatch(p, emptyHistory(), upd(p, 'orders', 'status', { name: 'state' })).project;
    const inc = v.validate(next, diffModel(p, next));
    expect(inc.checkedTables).toBe(1);
    expect(inc.ms).toBeLessThan(150);
    // Changing the engine forces a full run.
    expect(diffModel(p, { ...p, target: MY })).toBe('all');
  });
});
