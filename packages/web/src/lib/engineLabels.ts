import { formatType, type DataType } from '@erd/model';
export { ENGINE_ORDER, getDialect } from '@erd/dialects';

/** Type as shown in lists and dialogs, e.g. NVARCHAR(MAX), numeric(12,2). */
export const formatTypeLabel = (t: DataType) => formatType(t);
