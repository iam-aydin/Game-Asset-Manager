/**
 * Sortable fields exposed in the grid toolbar. Everything after `ext` is read
 * from the metadata stored when a file's thumbnail was rendered, so files
 * without that value (not rendered yet, or the wrong kind of file, like fps on
 * a model) sort to the end in either direction via NULLS LAST.
 */
export const SORT_FIELDS = [
  'filename',
  'mtime',
  'size',
  'ext',
  'vertices',
  'triangles',
  'resolution',
  'duration',
  'audioBitrate',
  'videoBitrate',
  'fps'
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  field: SortField;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortSpec = { field: 'filename', direction: 'asc' };

const SORT_FIELD_SET: ReadonlySet<string> = new Set(SORT_FIELDS);

export function isSortField(value: unknown): value is SortField {
  return typeof value === 'string' && SORT_FIELD_SET.has(value);
}

export function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

export function isSortSpec(value: unknown): value is SortSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { field?: unknown; direction?: unknown };
  return isSortField(v.field) && isSortDirection(v.direction);
}

export const SORT_LABELS: Record<SortField, string> = {
  filename: 'Name',
  mtime: 'Modified',
  size: 'Size',
  ext: 'Type',
  vertices: 'Vertices',
  triangles: 'Triangles',
  resolution: 'Resolution',
  duration: 'Length',
  audioBitrate: 'Audio bitrate',
  videoBitrate: 'Video bitrate',
  fps: 'Frame Rate'
};
