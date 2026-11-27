import type { Command, Id, Project, Relationship, Table, TableItemKind } from '@erd/model';
import type { Dialect } from '@erd/dialects';

export type Severity = 'error' | 'warning' | 'info';

/** Where an issue points (design §6.1). `field` lets the editor highlight the exact input. */
export interface IssueTarget {
  kind: 'model' | 'table' | 'column' | 'relationship' | 'item';
  tableId?: Id;
  columnId?: Id;
  relationshipId?: Id;
  itemKind?: TableItemKind;
  itemId?: Id;
  field?: 'name' | 'type' | 'length' | 'precision' | 'default' | 'identity' | 'nullable' | 'primaryKey' | 'schema' | 'columns' | 'expression' | 'onDelete' | 'onUpdate';
}

/** A one-click correction: plain model commands, so it can cross the worker boundary and be undone. */
export interface QuickFix {
  label: string;
  commands: Command[];
}

export interface Issue {
  /** Stable key (rule + target) used to diff issue sets and as a React key. */
  key: string;
  ruleId: string;
  severity: Severity;
  target: IssueTarget;
  /** One line: what is wrong. */
  message: string;
  /** Why it matters for this engine. */
  explanation: string;
  fixes: QuickFix[];
}

export interface RuleContext {
  project: Project;
  dialect: Dialect;
  version: string | undefined;
  /** Display name such as "PostgreSQL 16". */
  engineLabel: string;
  tableById: Map<Id, Table>;
}

export interface TableRule {
  id: string;
  scope: 'table';
  check(ctx: RuleContext, table: Table): Issue[];
}
export interface RelationshipRule {
  id: string;
  scope: 'relationship';
  check(ctx: RuleContext, rel: Relationship): Issue[];
}
export interface ModelRule {
  id: string;
  scope: 'model';
  check(ctx: RuleContext): Issue[];
}
export type Rule = TableRule | RelationshipRule | ModelRule;
