import { createEmptyProject } from './project';
import { makeColumn, newRelationship } from './factory';
import { newId } from './ids';
import type { Column, Project, Table } from './types';

/** The e-commerce sample used by "Open sample" and the empty state. */
export function createSampleProject(): Project {
  const p = createEmptyProject('shop_schema');
  const tbl = (name: string, color: Table['color'], cols: Column[], pk: string[]): Table => ({
    id: newId('t'), name, color, columns: cols,
    primaryKey: { columnIds: cols.filter((c) => pk.includes(c.name)).map((c) => c.id) },
  });
  const id = () => makeColumn('id', 'bigint', { nullable: false, identity: true });

  const customers = tbl('customers', 'sunrise', [
    id(),
    makeColumn('email', 'varchar', { nullable: false }),
    makeColumn('full_name', 'varchar', { type: { name: 'varchar', length: 120 } }),
    makeColumn('created_at', 'timestamptz', { nullable: false, default: { kind: 'expression', value: 'now()' } }),
  ], ['id']);
  const orders = tbl('orders', 'sunrise', [
    id(),
    makeColumn('customer_id', 'bigint', { nullable: false }),
    makeColumn('status', 'varchar', { type: { name: 'varchar', length: 20 }, nullable: false, default: { kind: 'literal', value: 'pending' } }),
    makeColumn('total', 'decimal', { type: { name: 'decimal', precision: 12, scale: 2 } }),
    makeColumn('placed_at', 'timestamptz', { nullable: false, default: { kind: 'expression', value: 'now()' } }),
  ], ['id']);
  const products = tbl('products', 'violet', [
    id(),
    makeColumn('sku', 'varchar', { type: { name: 'varchar', length: 40 }, nullable: false }),
    makeColumn('name', 'varchar', { nullable: false }),
    makeColumn('price', 'decimal', { type: { name: 'decimal', precision: 10, scale: 2 }, nullable: false }),
  ], ['id']);
  const items = tbl('order_items', 'sunrise', [
    makeColumn('order_id', 'bigint', { nullable: false }),
    makeColumn('product_id', 'bigint', { nullable: false }),
    makeColumn('quantity', 'integer', { nullable: false, default: { kind: 'literal', value: '1' } }),
    makeColumn('unit_price', 'decimal', { type: { name: 'decimal', precision: 10, scale: 2 }, nullable: false }),
  ], ['order_id', 'product_id']);

  const col = (t: Table, n: string) => t.columns.find((c) => c.name === n)!.id;
  p.model.tables = [customers, orders, items, products];
  p.model.relationships = [
    newRelationship(orders.id, customers.id, [{ child: col(orders, 'customer_id'), parent: col(customers, 'id') }]),
    { ...newRelationship(items.id, orders.id, [{ child: col(items, 'order_id'), parent: col(orders, 'id') }]), onDelete: 'cascade' },
    newRelationship(items.id, products.id, [{ child: col(items, 'product_id'), parent: col(products, 'id') }]),
  ];
  p.layout.positions = {
    [customers.id]: { x: 40, y: 60 },
    [orders.id]: { x: 360, y: 40 },
    [items.id]: { x: 680, y: 80 },
    [products.id]: { x: 680, y: 320 },
  };
  return p;
}
