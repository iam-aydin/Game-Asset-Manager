import path from 'node:path';
import { app, net, protocol } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { getOpenLibrary } from '@main/libraries/manager';
import { thumbFilePath } from '@main/thumb-pool/storage';
import { libraryThumbsDir } from '@main/appdata';
import { isCoverCapableExt, readAudioCover, readAudioCoverThumb } from '@main/audio-cover';
import type { AudioCover } from '@main/audio-cover';
import { scopedLogger } from '@main/logger';
import { isVideoPath, serveRangedFile } from './serve-file';
import { playableCachePath } from '@main/ipc/video-fallback';

const log = scopedLogger('protocol');

export const SCHEME_THUMB = 'wh3d-thumb';
export const SCHEME_FILE = 'wh3d-file';
export const SCHEME_ASSET = 'gam-asset';
export const SCHEME_COVER = 'wh3d-cover';

/**
 * Must be called BEFORE app.whenReady so the schemes are recognised by the
 * renderer's CSP and registered as standard URL schemes.
 */
export function registerAssetSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME_THUMB,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    },
    {
      scheme: SCHEME_FILE,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: false
      }
    },
    {
      scheme: SCHEME_COVER,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    },
    {
      scheme: SCHEME_ASSET,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ]);
}

interface ParsedAssetURL {
  libraryId: string;
  fileId: number;
}

interface ParsedRelURL {
  libraryId: string;
  relPath: string;
}

/**
 * URL shape: wh3d-thumb://<libraryId>/<fileId>
 *            wh3d-file://<libraryId>/<fileId>
 *            wh3d-cover://<libraryId>/<fileId>
 * Hosts and paths can both contain numbers; we treat the host as libraryId
 * and the first non-empty path segment as the integer fileId.
 */
function parse(url: string): ParsedAssetURL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const libraryId = parsed.hostname;
  if (!libraryId) return null;
  const seg = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  const fileId = Number.parseInt(seg, 10);
  if (!Number.isFinite(fileId) || fileId <= 0) return null;
  return { libraryId, fileId: fileId >= 1000000000 ? fileId % 1000000000 : fileId };
}

/**
 * URL shape: wh3d-file://<libraryId>/rel/<url-encoded relPath>
 * Used for glTF sibling resources (.bin, textures, etc.) that aren't
 * individually tracked FileRecords in the DB — we just need to read a byte
 * range off disk relative to the library root.
 */
function parseRel(url: string): ParsedRelURL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const libraryId = parsed.hostname;
  if (!libraryId) return null;
  const rawPath = parsed.pathname.replace(/^\/+/, '');
  const [head, ...rest] = rawPath.split('/');
  if (head !== 'rel' || rest.length === 0) return null;
  return { libraryId, relPath: decodeURIComponent(rest.join('/')) };
}

function notFound(message: string): Response {
  return new Response(message, { status: 404, headers: { 'content-type': 'text/plain' } });
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400, headers: { 'content-type': 'text/plain' } });
}

function coverResponse(cover: AudioCover): Response {
  return new Response(new Uint8Array(cover.data), {
    status: 200,
    headers: { 'content-type': cover.mime }
  });
}

/**
 * Video files go through the Range-aware server so <video> can seek; every
 * other file type keeps the original net.fetch(file://) behaviour.
 */
function serveAssetFile(req: Request, abs: string): Promise<Response> | Response {
  if (isVideoPath(abs)) return serveRangedFile(req, abs);
  return net.fetch(pathToFileURL(abs).toString());
}

/**
 * CSP for HTML pages shown in the preview iframe. Sent as a response header so
 * the page gets its own policy instead of inheriting the app's script-src 'self'.
 * Scripts may run (inline or from the library) but nothing can touch the
 * network, frames, forms or plugins.
 */
const HTML_PREVIEW_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline' wh3d-file:",
  'img-src wh3d-file: data:',
  "style-src wh3d-file: 'unsafe-inline'",
  'font-src wh3d-file: data:',
  'media-src wh3d-file: data:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

function withHtmlCsp(abs: string, res: Response): Response {
  if (!/\.html?$/i.test(abs)) return res;
  const headers = new Headers(res.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('content-security-policy', HTML_PREVIEW_CSP);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function registerAssetProtocols(): void {
  protocol.handle(SCHEME_THUMB, async (req) => {
    const parsed = parse(req.url);
    if (!parsed) {
      log.warn('invalid wh3d-thumb url', { url: req.url });
      return badRequest('Invalid wh3d-thumb URL');
    }
    const lib = getOpenLibrary(parsed.libraryId);
    if (!lib) return notFound(`Library ${parsed.libraryId} not open`);

    // Audio files with embedded artwork use their cover as the thumbnail.
    // Anything else (no cover, not audio) falls through to the rendered
    // waveform / model thumbnail exactly as before.
    const file = lib.files.getById(parsed.fileId);
    if (file && isCoverCapableExt(file.ext)) {
      const audioAbs = lib.resolver.toAbsolute(file.relPath);
      const cover = await readAudioCoverThumb(audioAbs);
      if (cover) return coverResponse(cover);
    }

    const abs = thumbFilePath(libraryThumbsDir(lib.entry.id), parsed.fileId);
    if (!existsSync(abs)) return notFound('Thumbnail not yet rendered');
    return net.fetch(pathToFileURL(abs).toString());
  });

  // Full-size embedded cover art for the audio player. 404 when the file has
  // no cover — the player treats that as "don't show a cover slot".
  protocol.handle(SCHEME_COVER, async (req) => {
    const parsed = parse(req.url);
    if (!parsed) {
      log.warn('invalid wh3d-cover url', { url: req.url });
      return badRequest('Invalid wh3d-cover URL');
    }
    const lib = getOpenLibrary(parsed.libraryId);
    if (!lib) return notFound(`Library ${parsed.libraryId} not open`);
    const file = lib.files.getById(parsed.fileId);
    if (!file) return notFound('File not in library');
    if (!isCoverCapableExt(file.ext)) return notFound('Not an audio file');
    const abs = lib.resolver.toAbsolute(file.relPath);
    if (!existsSync(abs)) return notFound('File missing on disk');

    const cover = await readAudioCover(abs);
    if (!cover) return notFound('No embedded cover');
    return coverResponse(cover);
  });

  protocol.handle(SCHEME_FILE, async (req) => {
    // glTF sibling resources (scene.bin, textures/*.png) resolve by relative
    // path, not by DB file id — they're not tracked FileRecords.
    const rel = parseRel(req.url);
    if (rel) {
      const lib = getOpenLibrary(rel.libraryId);
      if (!lib) return notFound(`Library ${rel.libraryId} not open`);
      const abs = lib.resolver.toAbsolute(rel.relPath);
      const mountRoot = path.resolve(lib.entry.mountPath);
      const resolvedAbs = path.resolve(abs);
      if (resolvedAbs !== mountRoot && !resolvedAbs.startsWith(mountRoot + path.sep)) {
        log.warn('rejected out-of-library rel path', {
          libraryId: rel.libraryId,
          relPath: rel.relPath
        });
        return badRequest('Path escapes library root');
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        log.warn('rel file missing on disk for wh3d-file', {
          libraryId: rel.libraryId,
          relPath: rel.relPath,
          abs
        });
        return notFound('File missing on disk');
      }
      // .html pages also get their own CSP header (used by the HTML preview).
      return withHtmlCsp(abs, await serveAssetFile(req, abs));
    }

    const parsed = parse(req.url);
    if (!parsed) {
      log.warn('invalid wh3d-file url', { url: req.url });
      return badRequest('Invalid wh3d-file URL');
    }
    const lib = getOpenLibrary(parsed.libraryId);
    if (!lib) return notFound(`Library ${parsed.libraryId} not open`);
    const file = lib.files.getById(parsed.fileId);
    if (!file) return notFound('File not in library');
    const abs = lib.resolver.toAbsolute(file.relPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      log.warn('file missing on disk for wh3d-file', {
        libraryId: parsed.libraryId,
        fileId: parsed.fileId,
        abs
      });
      return notFound('File missing on disk');
    }
    const pb = new URL(req.url).searchParams.get('pb') === '1' ? playableCachePath(parsed.libraryId, parsed.fileId) : null;
    if (pb && existsSync(pb)) return serveRangedFile(req, pb);
    return serveAssetFile(req, abs);
  });

  // Bundled app assets (the HDRI files) for the packaged build. Chromium
  // refuses fetch() on file:// URLs, so the renderer asks for
  // gam-asset://bundle/<file> and we read it out of out/renderer/assets.
  protocol.handle(SCHEME_ASSET, async (req) => {
    let name: string;
    try {
      name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
    } catch {
      return badRequest('Invalid gam-asset URL');
    }
    // A plain file name only (no folders), and only the asset types we ship.
    if (name !== path.basename(name) || !/\.hdr$/i.test(name)) {
      return badRequest('Not an allowed asset');
    }
    const abs = path.join(app.getAppPath(), 'out', 'renderer', 'assets', name);
    try {
      const data = await readFile(abs);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'access-control-allow-origin': '*'
        }
      });
    } catch {
      return notFound('Asset not found');
    }
  });

  // Sanity: registering the protocol must happen after app is ready.
  if (!app.isReady()) {
    throw new Error('registerAssetProtocols must be called inside app.whenReady()');
  }
}