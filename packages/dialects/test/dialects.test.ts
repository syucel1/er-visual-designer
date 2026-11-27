import { describe, expect, it } from 'vitest';
import { createSampleProject, dispatch, emptyHistory, formatType, LOGICAL_TYPES, undo, type LogicalTypeName, type Project } from '@erd/model';
import { changeTypeTo, DIALECTS, findType, getDialect, normalizeType, planConversion, typeDefaults, typesFor, versionAtLeast } from '../src';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('dialect type tables', () => {
  for (const d of Object.values(DIALECTS)) {
    it(`${d.displayName}: every logical type maps to a valid type within range`, () => {
      for (const { name } of LOGICAL_TYPES) {
        for (const version of d.versions.length ? d.versions : [undefined]) {
          const { type } = d.mapLogical(name, undefined, version);
          const desc = findType(d, type.name);
          expect(desc, `${d.id} ${version} ${name} → ${type.name}`).toBeDefined();
          expect(versionAtLeast(d, version, desc!.minVersion), `${type.name} not in ${version}`).toBe(true);
          if (type.length != null) expect(type.length).toBeLessThanOrEqual(desc!.length!.max);
          if (type.precision != null && desc!.precision) expect(type.precision).toBeLessThanOrEqual(desc!.precision.max);
        }
      }
    });

    it(`${d.displayName}: non-lossy mappings round-trip to the same logical type`, () => {
      for (const { name } of LOGICAL_TYPES) {
        const m = d.mapLogical(name, undefined, d.defaultVersion);
        if (m.lossy) continue;
        const back = d.toLogical(m.type);
        // Engines without a distinct type for some logical types legitimately collapse them.
        const collapses: Partial<Record<string, LogicalTypeName[]>> = { sqlite: ['smallint', 'integer', 'boolean', 'real', 'uuid', 'json'], mysql: [], sqlserver: ['json'] };
        if (collapses[d.id]?.includes(name)) continue;
        expect(back, `${d.id}: ${name} → ${formatType(m.type)} → ${back}`).toBe(name);
      }
    });
  }

  it('resolves aliases case-insensitively and normalises spelling', () => {
    const pg = getDialect('postgresql');
    expect(findType(pg, 'INT4')?.name).toBe('integer');
    expect(findType(pg, 'character  varying')?.name).toBe('varchar');
    expect(normalizeType(pg, { name: 'int8' })).toMatchObject({ name: 'bigint', logical: 'bigint' });
    expect(findType(getDialect('mysql'), 'nonsense')).toBeUndefined();
  });

  it('versions gate types: Oracle BOOLEAN needs 23ai, JSON needs 21c', () => {
    const ora = getDialect('oracle');
    expect(typesFor(ora, '19c').some((t) => t.name === 'BOOLEAN')).toBe(false);
    expect(typesFor(ora, '23ai').some((t) => t.name === 'BOOLEAN')).toBe(true);
    expect(ora.mapLogical('boolean', undefined, '19c')).toMatchObject({ type: { name: 'NUMBER', precision: 1, scale: 0 }, lossy: expect.stringMatching(/23ai/) });
    expect(ora.mapLogical('json', undefined, '19c').type.name).toBe('CLOB');
  });

  it('Oracle NUMBER(p,0) is read as an integer type', () => {
    const ora = getDialect('oracle');
    expect(ora.toLogical({ name: 'NUMBER', precision: 10, scale: 0 })).toBe('integer');
    expect(ora.toLogical({ name: 'NUMBER', precision: 19, scale: 0 })).toBe('bigint');
    expect(ora.toLogical({ name: 'NUMBER', precision: 5, scale: 0 })).toBe('smallint');
    expect(ora.toLogical({ name: 'NUMBER', precision: 12, scale: 2 })).toBe('decimal');
  });

  it('carries and clamps parameters', () => {
    expect(getDialect('sqlserver').mapLogical('varchar', { name: 'varchar', length: 10000 }, '2022').type).toMatchObject({ name: 'NVARCHAR', max: true });
    expect(getDialect('mysql').mapLogical('decimal', { name: 'numeric', precision: 100, scale: 40 }, '8.4')).toMatchObject({ type: { precision: 65, scale: 30 }, lossy: expect.stringMatching(/precision 100 reduced/) });
    expect(getDialect('oracle').mapLogical('varchar', { name: 'varchar', length: 10000 }, '23ai')).toMatchObject({ type: { name: 'CLOB' }, lossy: expect.stringMatching(/CLOB/) });
    expect(changeTypeTo(getDialect('mysql'), { name: 'VARCHAR', length: 300 }, 'CHAR')).toMatchObject({ name: 'CHAR', length: 255 });
  });

  it('type defaults per engine', () => {
    expect(typeDefaults(getDialect('oracle'), '23ai').idType).toMatchObject({ name: 'NUMBER', precision: 19, scale: 0 });
    expect(typeDefaults(getDialect('sqlserver'), '2022').columnType).toMatchObject({ name: 'NVARCHAR', length: 255 });
  });
});

describe('conversion between engines', () => {
  const base = (): Project => {
    const p = createSampleProject();
    const r = planConversion(p, { engine: 'postgresql', version: '16' });
    return dispatch(p, emptyHistory(), r.command).project;
  };

  it('generic → PostgreSQL maps every column to a PostgreSQL type', () => {
    const p = base();
    expect(p.target).toEqual({ engine: 'postgresql', version: '16' });
    const pg = getDialect('postgresql');
    expect(p.model.tables.every((t) => t.columns.every((c) => findType(pg, c.type.name)))).toBe(true);
  });

  it('PostgreSQL → MySQL reports changes and lossy conversions, and one undo restores everything', () => {
    const p = base();
    const plan = planConversion(p, { engine: 'mysql', version: '8.4' });
    expect(plan.fromLabel).toBe('PostgreSQL 16');
    expect(plan.toLabel).toBe('MySQL 8.4');
    expect(plan.changes.find((c) => c.columnName === 'created_at')).toMatchObject({ to: { name: 'TIMESTAMP' }, lossy: expect.stringMatching(/UTC/) });
    expect(plan.changes.find((c) => c.columnName === 'email')?.to).toMatchObject({ name: 'VARCHAR', length: 255 });
    const r = dispatch(p, emptyHistory(), plan.command);
    expect(r.history.past).toHaveLength(1);
    expect(clone(undo(r.project, r.history)!.project)).toEqual(clone(p));
  });

  it('PostgreSQL → SQLite → PostgreSQL keeps logical types', () => {
    const p = base();
    const lite = dispatch(p, emptyHistory(), planConversion(p, { engine: 'sqlite' }).command).project;
    const back = dispatch(lite, emptyHistory(), planConversion(lite, { engine: 'postgresql', version: '16' }).command).project;
    const types = (x: Project) => x.model.tables.flatMap((t) => t.columns.map((c) => c.type.name));
    expect(types(back)).toEqual(types(p));
  });

  it('Oracle 23ai → 19c only changes types the older version lacks', () => {
    let p = base();
    p = dispatch(p, emptyHistory(), planConversion(p, { engine: 'oracle', version: '23ai' }).command).project;
    const t = p.model.tables[0]!;
    p = dispatch(p, emptyHistory(), { type: 'updateColumn', tableId: t.id, columnId: t.columns[1]!.id, patch: { type: { name: 'BOOLEAN', logical: 'boolean' } } }).project;
    const plan = planConversion(p, { engine: 'oracle', version: '19c' });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ from: { name: 'BOOLEAN' }, to: { name: 'NUMBER', precision: 1 } });
  });

  it('unsupported referential actions fall back to NO ACTION (Oracle has no ON UPDATE CASCADE)', () => {
    let p = base();
    const rel = p.model.relationships[0]!;
    p = dispatch(p, emptyHistory(), { type: 'updateRelationship', relationshipId: rel.id, patch: { onUpdate: 'cascade', onDelete: 'restrict' } }).project;
    const plan = planConversion(p, { engine: 'oracle', version: '23ai' });
    expect(plan.actionChanges.map((a) => `${a.field}:${a.from}`).sort()).toEqual(['onDelete:restrict', 'onUpdate:cascade']);
    const next = dispatch(p, emptyHistory(), plan.command).project;
    expect(next.model.relationships[0]).toMatchObject({ onDelete: 'no_action', onUpdate: 'no_action' });
  });

  it('a 50-table model converts in well under a second', () => {
    const p = base();
    const big = clone(p);
    for (let i = 0; i < 12; i++) for (const t of p.model.tables) big.model.tables.push({ ...clone(t), id: `${t.id}_${i}`, name: `${t.name}_${i}`, columns: t.columns.map((c) => ({ ...clone(c), id: `${c.id}_${i}` })), primaryKey: undefined });
    expect(big.model.tables.length).toBeGreaterThanOrEqual(50);
    const t0 = performance.now();
    const plan = planConversion(big, { engine: 'mysql', version: '8.4' });
    const r = dispatch(big, emptyHistory(), plan.command);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.project.target.engine).toBe('mysql');
  });
});
