/// <reference lib="webworker" />
import { Validator, type ChangeSet } from '@erd/validation';
import type { Project } from '@erd/model';

/** Runs validation off the UI thread (design §6.1). Keeps the incremental cache between messages. */
const validator = new Validator();

self.onmessage = (e: MessageEvent<{ seq: number; project: Project; changes: ChangeSet | 'all' }>) => {
  const { seq, project, changes } = e.data;
  const result = validator.validate(project, changes);
  (self as unknown as Worker).postMessage({ seq, result });
};
