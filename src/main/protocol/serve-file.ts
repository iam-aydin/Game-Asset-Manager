import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Serves a file from disk with HTTP Range support (206 Partial Content).
 *
 * Chromium's <video> element seeks by issuing `Range: bytes=...` requests. It
 * also needs `Accept-Ranges: bytes` on the response, or the seek bar is dead.
 * Used by the wh3d-file:// handler for video files only; everything else keeps
 * going through net.fetch(file://) exactly as before.
 *
 * Any extension missing from VIDEO_MIME silently falls back to the plain
 * (non-seekable) path, so add new video formats here.
 */

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.bik': 'video/vnd.radgamettools.bink'
};

export function isVideoPath(abs: string): boolean {
  return path.extname(abs).toLowerCase() in VIDEO_MIME;
}

type ParsedRange = { start: number; end: number } | 'invalid' | null;

/** Parses a single `bytes=a-b` range. Returns null when absent/unsupported (serve whole file). */
function parseRange(header: string, size: number): ParsedRange {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/**
 * Node stream -> web ReadableStream with backpressure. Written by hand rather
 * than Readable.toWeb() because the latter can throw "Controller is already
 * closed" when the media element cancels a request mid-seek.
 */
function toWebStream(stream: Readable): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk: Buffer) => {
        if (closed) return;
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) stream.pause();
      });
      stream.on('end', () => {
        if (closed) return;
        closed = true;
        controller.close();
      });
      stream.on('error', (err) => {
        if (closed) return;
        closed = true;
        controller.error(err);
      });
    },
    pull() {
      stream.resume();
    },
    cancel() {
      closed = true;
      stream.destroy();
    }
  });
}

export function serveRangedFile(req: Request, abs: string): Response {
  const size = statSync(abs).size;
  const contentType = VIDEO_MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const baseHeaders = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*'
  };

  const rangeHeader = req.headers.get('range');
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;

  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'content-range': `bytes */${size}` }
    });
  }

  if (!range) {
    return new Response(toWebStream(createReadStream(abs)), {
      status: 200,
      headers: { ...baseHeaders, 'content-length': String(size) }
    });
  }

  const { start, end } = range;
  return new Response(toWebStream(createReadStream(abs, { start, end })), {
    status: 206,
    headers: {
      ...baseHeaders,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`
    }
  });
}