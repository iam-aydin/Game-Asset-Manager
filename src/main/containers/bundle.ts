import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

// Patch 2: finds everything a model needs and plans how to move or copy it.
// This file only PLANS. It never touches the disk.

/** Extensions that count as "a model" (edit freely). */
export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'fbx', 'stl', '3mf', 'dae', 'ply'];
const TEXTURE_EXTS = ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'tif', 'tiff', 'dds', 'webp', 'hdr', 'exr', 'ktx', 'ktx2'];

/** Folder names that say nothing about the model. Drive roots and "New folder (2)" are handled separately. */
export const DEFAULT_GENERIC_NAMES = [
  'desktop', 'documents', 'downloads', 'pictures', 'users', 'scene',
  'models', 'assets', 'textures', 'temp', 'new folder'
];

const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const isModelFile = (name: string) => MODEL_EXTS.includes(extname(name).slice(1).toLowerCase());

export function isGenericName(name: string, list: string[] = DEFAULT_GENERIC_NAMES): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true; // drive root
  if (/^[a-z]:\\?$/.test(n)) return true;
  if (/^new folder( \(\d+\))?$/.test(n)) return true;
  return list.some((g) => g.trim().toLowerCase() === n);
}

function safeName(name: string): string {
  let n = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  return n || 'model';
}

/** Parent folder name, unless it is generic or holds other models: then the file name. */
export function pickBundleName(modelAbs: string, list: string[] = DEFAULT_GENERIC_NAMES): string {
  const parent = dirname(modelAbs);
  const fileStem = basename(modelAbs, extname(modelAbs));
  const isRoot = dirname(parent) === parent;
  let others = 0;
  try {
    for (const e of readdirSync(parent, { withFileTypes: true })) {
      if (e.isFile() && isModelFile(e.name) && key(join(parent, e.name)) !== key(modelAbs)) others++;
    }
  } catch {
    // unreadable: treat as no other models
  }
  if (isRoot || isGenericName(basename(parent), list) || others > 0) return safeName(fileStem);
  return safeName(basename(parent));
}

/** name, name(1), name(2) ... that does not exist in `parent` yet. */
export function uniqueDirName(parent: string, name: string): string {
  if (!existsSync(join(parent, name))) return name;
  for (let i = 1; i < 10000; i++) {
    const c = `${name}(${i})`;
    if (!existsSync(join(parent, c))) return c;
  }
  return `${name}(${Date.now()})`;
}

// ---- finding the textures / bin files -------------------------------------

function readText(p: string, enc: BufferEncoding = 'utf8'): string {
  try {
    return readFileSync(p, enc);
  } catch {
    return '';
  }
}

function indexFiles(root: string, depth = 3): Map<string, string> {
  const map = new Map<string, string>();
  let level = [root];
  for (let d = 0; d <= depth && level.length; d++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && e.name !== '.git') next.push(full);
        } else if (e.isFile() && !map.has(e.name.toLowerCase())) {
          map.set(e.name.toLowerCase(), full);
        }
      }
    }
    level = next;
  }
  return map;
}

export interface Bundle {
  model: string;
  /** Absolute paths, the model itself included. */
  files: string[];
  /** References that were not found on disk. */
  missing: string[];
}

export function resolveBundle(model: string): Bundle {
  const dir = dirname(model);
  const ext = extname(model).slice(1).toLowerCase();
  const found = new Map<string, string>([[key(model), model]]);
  const missing: string[] = [];

  const addAny = (cands: string[], base: string): boolean => {
    for (const raw of cands) {
      let r = raw.trim().replace(/^["']|["']$/g, '');
      if (!r || /^(data:|https?:|file:)/i.test(r)) return true;
      try {
        r = decodeURIComponent(r);
      } catch {
        // keep as is
      }
      const abs = resolve(base, r.replace(/\\/g, '/'));
      try {
        if (existsSync(abs) && statSync(abs).isFile()) {
          found.set(key(abs), abs);
          return true;
        }
      } catch {
        // try the next candidate
      }
    }
    missing.push(cands[0]);
    return false;
  };

  if (ext === 'gltf') {
    try {
      const j = JSON.parse(readText(model));
      for (const item of [...(j.buffers ?? []), ...(j.images ?? [])]) {
        if (item && typeof item.uri === 'string') addAny([item.uri], dir);
      }
    } catch {
      // broken json: just the model
    }
  } else if (ext === 'obj') {
    const text = readText(model);
    for (const m of text.matchAll(/^\s*mtllib\s+(.+)$/gim)) {
      const mtlName = m[1].trim();
      if (!addAny([mtlName], dir)) continue;
      const mtlAbs = resolve(dir, mtlName.replace(/\\/g, '/'));
      for (const t of readText(mtlAbs).matchAll(/^\s*(?:map_\w+|bump|disp|decal|refl)\s+(.+)$/gim)) {
        const rest = t[1].trim();
        const last = rest.split(/\s+/).pop() ?? rest;
        addAny([rest, last], dirname(mtlAbs));
      }
    }
  } else if (ext !== 'glb') {
    // fbx, dae, ...: look for texture file names inside the file and match them to files next to it.
    let size = 0;
    try {
      size = statSync(model).size;
    } catch {
      // ignore
    }
    if (size > 0 && size <= 128 * 1024 * 1024) {
      const idx = indexFiles(dir);
      const re = new RegExp(`[\\w\\-. ()\\[\\]]+\\.(?:${TEXTURE_EXTS.join('|')})`, 'gi');
      for (const m of readText(model, 'latin1').matchAll(re)) {
        let name = m[0].trim();
        for (let i = 0; i < 4 && name.length > 4; i++, name = name.slice(1)) {
          const hit = idx.get(name.toLowerCase());
          if (hit) {
            found.set(key(hit), hit);
            break;
          }
        }
      }
    }
  }
  return { model, files: [...found.values()], missing };
}

/** Lowest folder that contains every file. Keeping the layout below it keeps relative paths working. */
export function commonRoot(files: string[]): string {
  const parts = files.map((f) => resolve(dirname(f)).split(sep));
  let n = parts[0].length;
  for (const p of parts) {
    let i = 0;
    while (i < n && i < p.length && key(p[i]) === key(parts[0][i])) i++;
    n = i;
  }
  const joined = parts[0].slice(0, Math.max(1, n)).join(sep);
  return /^[a-zA-Z]:$/.test(joined) ? joined + sep : joined || sep;
}

/** Files of this bundle that another model (in the same folder tree) also uses. */
export function findSharedFiles(model: string, bundle: Bundle, maxOthers = 50): Set<string> {
  const shared = new Set<string>();
  const mine = new Map(bundle.files.filter((f) => key(f) !== key(model)).map((f) => [key(f), f]));
  if (mine.size === 0) return shared;
  const others: string[] = [];
  let level = [dirname(model)];
  for (let d = 0; d <= 3 && level.length && others.length < maxOthers; d++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) next.push(full);
        else if (e.isFile() && isModelFile(e.name) && key(full) !== key(model)) others.push(full);
      }
    }
    level = next;
  }
  for (const other of others.slice(0, maxOthers)) {
    for (const f of resolveBundle(other).files) {
      if (mine.has(key(f))) shared.add(key(f));
    }
  }
  return shared;
}

export interface BundlePlan {
  name: string;
  destDir: string;
  root: string;
  moves: { from: string; to: string }[];
  copies: { from: string; to: string }[];
  missing: string[];
}

/**
 * mode 'move' (drag / Ctrl+X): shared files are copied, the rest moved.
 * mode 'copy' (Ctrl+C / Ctrl+V): everything is copied.
 */
export function planBundle(
  model: string,
  containerDir: string,
  mode: 'move' | 'copy' = 'move',
  genericList: string[] = DEFAULT_GENERIC_NAMES
): BundlePlan {
  const bundle = resolveBundle(model);
  const name = pickBundleName(model, genericList);
  const destDir = join(containerDir, uniqueDirName(containerDir, name));
  const root = commonRoot(bundle.files);
  const shared = mode === 'move' ? findSharedFiles(model, bundle) : new Set<string>();
  const moves: { from: string; to: string }[] = [];
  const copies: { from: string; to: string }[] = [];
  for (const f of bundle.files) {
    const item = { from: f, to: join(destDir, relative(root, f)) };
    const copyIt = mode === 'copy' || (key(f) !== key(model) && shared.has(key(f)));
    (copyIt ? copies : moves).push(item);
  }
  return { name, destDir, root, moves, copies, missing: bundle.missing };
}