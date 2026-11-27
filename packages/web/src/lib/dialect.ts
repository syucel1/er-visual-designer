import { useMemo } from 'react';
import { getDialect, targetLabel, typeDefaults, type Dialect } from '@erd/dialects';
import type { DataType, EngineTarget, TypeDefaults } from '@erd/model';
import { useStore } from '../store/store';

export interface TargetInfo {
  dialect: Dialect;
  version: string | undefined;
  label: string;
  defaults: TypeDefaults & { idType: DataType; columnType: DataType };
}

export function targetInfo(target: EngineTarget): TargetInfo {
  const dialect = getDialect(target.engine);
  const version = dialect.versions.length ? target.version ?? dialect.defaultVersion : undefined;
  return { dialect, version, label: targetLabel(target), defaults: typeDefaults(dialect, version) };
}

/** The project's engine: dialect, version, display label and type defaults for new tables/columns. */
export function useTarget(): TargetInfo {
  const target = useStore((s) => s.project.target);
  return useMemo(() => targetInfo(target), [target]);
}

/** Non-hook access for event handlers. */
export const currentTarget = () => targetInfo(useStore.getState().project.target);

export const ENGINE_COLORS: Record<string, string> = { postgresql: '#336791', mysql: '#00758f', sqlserver: '#cc2927', oracle: '#c74634', sqlite: '#0f80cc', generic: '#6b7088' };
