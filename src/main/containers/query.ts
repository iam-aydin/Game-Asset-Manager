import * as manager from '@main/libraries/manager';
import type { OpenLibrary } from '@main/libraries/manager';
import type { FileQueryRequest, FileRecord } from '@shared/types';
import * as store from './store';

/** Files from a library other than the requesting one get id = ordinal * SPAN + localId. */
export const LIB_ID_SPAN = 1000000000;

/**
 * All files of a global container, from every open library, in stored order,
 * with the simple filters applied (search, extension, rating, color).
 */
export function queryContainerFiles(
  home: OpenLibrary,
  req: Omit<FileQueryRequest, 'libraryId'>
): FileRecord[] {
  if (req.collectionId == null) return [];
  const c = store.get(req.collectionId);
  if (!c) return [];
  const ordinals = new Map(manager.listLibraries().map((l, i) => [l.id, i + 1] as const));
  const exts =
    req.extensions && req.extensions.length > 0
      ? new Set(req.extensions.map((e) => e.toLowerCase()))
      : null;
  const labels =
    req.colorLabels && req.colorLabels.length > 0 ? new Set<string>(req.colorLabels) : null;
  const needle = req.query?.trim().toLowerCase() ?? '';
  const out: FileRecord[] = [];
  for (const it of c.items) {
    const lib = manager.getOpenLibrary(it.libraryId);
    if (!lib) continue;
    const base = lib.files.getByRelPath(it.relPath);
    // getByRelPath has no thumbnail join; getById has.
    const f = base ? lib.files.getById(base.id) : null;
    if (!f) continue;
    if (exts && !exts.has(f.ext.toLowerCase())) continue;
    if (req.minRating && f.rating < req.minRating) continue;
    if (labels && (f.colorLabel == null || !labels.has(f.colorLabel))) continue;
    if (needle && !f.relPath.toLowerCase().includes(needle)) continue;
    out.push(
      lib.entry.id === home.entry.id
        ? f
        : { ...f, id: (ordinals.get(lib.entry.id) ?? 1) * LIB_ID_SPAN + f.id }
    );
    if (req.limit && out.length >= req.limit) break;
  }
  return out;
}