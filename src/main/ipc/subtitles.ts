import { ipcMain } from 'electron';
import './media-flags';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { scopedLogger } from '@main/logger';
import { getOpenLibrary } from '@main/libraries/manager';
import { extractEmbeddedSubs } from './embedded-subs';

const log = scopedLogger('subtitles');
const SUB_EXTS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

/** Same lookup the wh3d-file:// protocol handler uses (asset-protocols.ts). */
async function resolveFilePath(libraryId: string, fileId: number): Promise<string | null> {
  const lib = getOpenLibrary(libraryId);
  if (!lib) return null;
  // Same id normalisation as parse() in asset-protocols.ts
  const id = fileId >= 1000000000 ? fileId % 1000000000 : fileId;
  const file = lib.files.getById(id);
  if (!file) return null;
  return lib.resolver.toAbsolute(file.relPath);
}

async function readText(path: string): Promise<string> {
  const buf = await fs.readFile(path);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function srtToVtt(src: string): string {
  const body = src.replace(/\r\n?/g, '\n').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + body;
}

function assTime(t: string): string {
  const m = /^(\d+):(\d{2}):(\d{2})[.:](\d{1,2})$/.exec(t.trim());
  if (!m) return '00:00:00.000';
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4].padEnd(3, '0')}`;
}

function assToVtt(src: string): string {
  const out: string[] = ['WEBVTT', ''];
  let inEvents = false;
  let cols: string[] = [];
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) {
      cols = line.slice(7).split(',').map((c) => c.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(line) || cols.length === 0) continue;
    const fields = line.slice(9).replace(/^\s+/, '').split(',');
    const head = fields.slice(0, cols.length - 1);
    const text = fields.slice(cols.length - 1).join(',');
    const start = head[cols.indexOf('start')];
    const end = head[cols.indexOf('end')];
    if (start === undefined || end === undefined) continue;
    const clean = text
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    if (!clean) continue;
    out.push(`${assTime(start)} --> ${assTime(end)}`, clean, '');
  }
  return out.join('\n');
}

/** Finds movie.srt / movie.en.ass / ... next to the video and returns them as WebVTT. */
export function registerSubtitlesIpc(): void {
  ipcMain.handle('subtitles:list', async (_e, libraryId: string, fileId: number) => {
    try {
      const videoPath = await resolveFilePath(libraryId, fileId);
      if (!videoPath) return [];
      const dir = dirname(videoPath);
      const base = basename(videoPath, extname(videoPath)).toLowerCase();
      const names = (await fs.readdir(dir))
        .filter((n) => SUB_EXTS.has(extname(n).toLowerCase()) && n.toLowerCase().startsWith(base))
        .sort();
      const out: { label: string; vtt: string }[] = [];
      for (const n of names) {
        const ext = extname(n).toLowerCase();
        const text = await readText(join(dir, n));
        const vtt = ext === '.vtt' ? text : ext === '.srt' ? srtToVtt(text) : assToVtt(text);
        const suffix = n.slice(base.length, n.length - ext.length).replace(/^[.\-_ ]+/, '');
        out.push({ label: `${suffix || 'Subtitles'} (${ext.slice(1)})`, vtt });
      }
      // Subtitle tracks stored inside the video file itself (MP4 tx3g, MKV srt / ass).
      try {
        const embedded = await extractEmbeddedSubs(videoPath);
        log.info('embedded subtitles', { count: embedded.length });
        out.push(...embedded);
      } catch (err) {
        log.warn('embedded subtitle read failed', { error: String(err) });
      }
      return out;
    } catch (err) {
      log.warn('subtitle listing failed', { error: String(err) });
      return [];
    }
  });
}