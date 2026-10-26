import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Global containers: named groups of assets that are visible from every
 * library. Membership is stored as (libraryId, relPath) because per-library
 * file ids are not unique across libraries.
 */

export interface StoredItem {
  libraryId: string;
  relPath: string;
  addedAt: number;
}

export interface StoredContainer {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: StoredItem[];
}

interface StoreFile {
  version: 1;
  nextId: number;
  migratedLibraries: string[];
  containers: StoredContainer[];
}

let cache: StoreFile | null = null;

const filePath = (): string => join(app.getPath('userData'), 'containers.json');
const itemKey = (libraryId: string, relPath: string): string => `${libraryId}\u0000${relPath}`;

function load(): StoreFile {
  if (cache) return cache;
  const p = filePath();
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<StoreFile>;
      if (parsed && Array.isArray(parsed.containers)) {
        cache = {
          version: 1,
          nextId:
            typeof parsed.nextId === 'number'
              ? parsed.nextId
              : Math.max(0, ...parsed.containers.map((c) => c.id)) + 1,
          migratedLibraries: Array.isArray(parsed.migratedLibraries) ? parsed.migratedLibraries : [],
          containers: parsed.containers
        };
        return cache;
      }
    } catch {
      try {
        copyFileSync(p, p + '.corrupt');
      } catch {
        // ignore
      }
    }
  }
  cache = { version: 1, nextId: 1, migratedLibraries: [], containers: [] };
  return cache;
}

function save(): void {
  const p = filePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8');
  renameSync(tmp, p);
}

export function list(): StoredContainer[] {
  return [...load().containers].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

export function get(id: number): StoredContainer | null {
  return load().containers.find((c) => c.id === id) ?? null;
}

export function findByName(name: string): StoredContainer | null {
  const n = name.trim().toLowerCase();
  return load().containers.find((c) => c.name.toLowerCase() === n) ?? null;
}

export function create(name: string): StoredContainer {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Container name cannot be empty');
  if (findByName(trimmed)) throw new Error(`A container named "${trimmed}" already exists`);
  const s = load();
  const now = Date.now();
  const c: StoredContainer = { id: s.nextId++, name: trimmed, createdAt: now, updatedAt: now, items: [] };
  s.containers.push(c);
  save();
  return c;
}

export function rename(id: number, name: string): StoredContainer | null {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Container name cannot be empty');
  const c = get(id);
  if (!c) return null;
  const other = findByName(trimmed);
  if (other && other.id !== id) throw new Error(`A container named "${trimmed}" already exists`);
  c.name = trimmed;
  c.updatedAt = Date.now();
  save();
  return c;
}

export function remove(id: number): void {
  const s = load();
  s.containers = s.containers.filter((c) => c.id !== id);
  save();
}

export function addItems(id: number, items: { libraryId: string; relPath: string }[]): number {
  const c = get(id);
  if (!c) return 0;
  const have = new Set(c.items.map((i) => itemKey(i.libraryId, i.relPath)));
  const now = Date.now();
  let added = 0;
  for (const it of items) {
    const k = itemKey(it.libraryId, it.relPath);
    if (have.has(k)) continue;
    have.add(k);
    c.items.push({ libraryId: it.libraryId, relPath: it.relPath, addedAt: now });
    added++;
  }
  if (added > 0) {
    c.updatedAt = now;
    save();
  }
  return added;
}

export function removeItems(id: number, items: { libraryId: string; relPath: string }[]): number {
  const c = get(id);
  if (!c) return 0;
  const drop = new Set(items.map((i) => itemKey(i.libraryId, i.relPath)));
  const before = c.items.length;
  c.items = c.items.filter((i) => !drop.has(itemKey(i.libraryId, i.relPath)));
  const removed = before - c.items.length;
  if (removed > 0) {
    c.updatedAt = Date.now();
    save();
  }
  return removed;
}

/** relPaths of the container's items that belong to one library, in stored order. */
export function relPathsFor(id: number, libraryId: string): string[] {
  const c = get(id);
  return c ? c.items.filter((i) => i.libraryId === libraryId).map((i) => i.relPath) : [];
}

/** Keep membership in sync when files are moved/renamed. */
export function renamePaths(libraryId: string, renames: { from: string; to: string }[]): void {
  if (renames.length === 0) return;
  const map = new Map(renames.map((r) => [r.from, r.to] as const));
  let changed = false;
  for (const c of load().containers) {
    const seen = new Set<string>();
    const next: StoredItem[] = [];
    for (const it of c.items) {
      let rel = it.relPath;
      if (it.libraryId === libraryId) {
        const to = map.get(rel);
        if (to !== undefined) {
          rel = to;
          changed = true;
        }
      }
      const k = itemKey(it.libraryId, rel);
      if (seen.has(k)) {
        changed = true;
        continue;
      }
      seen.add(k);
      next.push(rel === it.relPath ? it : { ...it, relPath: rel });
    }
    c.items = next;
  }
  if (changed) save();
}

/** Drop a deleted file from every container. */
export function removePath(libraryId: string, relPath: string): void {
  let changed = false;
  for (const c of load().containers) {
    const before = c.items.length;
    c.items = c.items.filter((i) => !(i.libraryId === libraryId && i.relPath === relPath));
    if (c.items.length !== before) changed = true;
  }
  if (changed) save();
}

export function isMigrated(libraryId: string): boolean {
  return load().migratedLibraries.includes(libraryId);
}

export function markMigrated(libraryId: string): void {
  const s = load();
  if (!s.migratedLibraries.includes(libraryId)) {
    s.migratedLibraries.push(libraryId);
    save();
  }
}