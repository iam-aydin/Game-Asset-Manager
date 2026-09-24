import * as THREE from 'three';
import { disposeObject, loadModel } from './three/loaders';
import { frameObject } from './three/framing';
import { extract3MFEmbeddedThumbnail } from './three/three-mf-fast-path';
import { extractMetadata, thumbnailOnlyMetadata } from './three/metadata';
import { computeMeshVolume, validateScene } from './three/validation';
import { computePrintability } from './three/printability';
import { extractFormatMetadata } from './three/format-metadata';
import { DEFAULT_LIGHTING_STYLE, LightingRig, type LightingStyle } from './three/lighting';
import { THUMB_WORKER_CHANNEL, THUMB_WORKER_RENDER_SIZE } from '@shared/thumb-worker-protocol';
import type { ThumbRenderRequest, ThumbRenderResult } from '@shared/thumb-worker-protocol';
import type { ExtractedMetadata } from '@shared/types';
import { isAudioExtension, isImageExtension } from '@shared/formats';
import type { IpcRenderer } from 'electron';
import type { promises as FsPromises } from 'node:fs';
import { scopedLogger } from './logger';

const log = scopedLogger('thumb-worker');

const nodeRequire = (window as unknown as { require: NodeRequire }).require;
const fsSync = nodeRequire('fs') as typeof import('fs');
const nodePath = nodeRequire('path') as typeof import('path');
const { ipcRenderer } = nodeRequire('electron') as { ipcRenderer: IpcRenderer };
const fs = (nodeRequire('fs') as { promises: typeof FsPromises }).promises;

const KNOWN_3D_EXTENSIONS = new Set([
  'gltf', 'glb', 'obj', 'fbx', '3mf', 'stl', 'dae', 'ply', 'blend'
]);

const DOCUMENT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'doc', 'docx', 'pdf'
]);

function resolveGltfResource(gltfAbsPath: string): (relativeUrl: string) => string {
  const dir = nodePath.dirname(gltfAbsPath);
  return (relativeUrl: string): string => {
    if (/^(data:|blob:|https?:)/i.test(relativeUrl)) return relativeUrl;
    const abs = nodePath.join(dir, decodeURIComponent(relativeUrl));
    const bytes = fsSync.readFileSync(abs);
    const ext = nodePath.extname(abs).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      ext === '.webp' ? 'image/webp' :
      'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  };
}

function mimeForImageExt(ext: string): string {
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'bmp': return 'image/bmp';
    default: return 'application/octet-stream';
  }
}

let renderer: THREE.WebGLRenderer | null = null;
let jobsRendered = 0;

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  canvas.width = THUMB_WORKER_RENDER_SIZE;
  canvas.height = THUMB_WORKER_RENDER_SIZE;
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(THUMB_WORKER_RENDER_SIZE, THUMB_WORKER_RENDER_SIZE, false);
  renderer.setClearColor(0x101113, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

interface RenderOutput {
  png: Uint8Array;
  metadata: ExtractedMetadata;
}

async function renderImageThumbnail(req: ThumbRenderRequest): Promise<RenderOutput> {
  const buffer = await fs.readFile(req.absPath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  const blob = new Blob([arrayBuffer], { type: mimeForImageExt(req.ext) });
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;

  const size = THUMB_WORKER_RENDER_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) {
    bitmap.close();
    throw new Error('2D context unavailable for image thumbnail');
  }

  ctx2d.fillStyle = '#101113';
  ctx2d.fillRect(0, 0, size, size);

  const scale = Math.min(size / width, size / height);
  const drawW = width * scale;
  const drawH = height * scale;
  ctx2d.drawImage(bitmap, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
  bitmap.close();

  const outBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!outBlob) throw new Error('canvas.toBlob returned null for image thumbnail');
  const png = new Uint8Array(await outBlob.arrayBuffer());

  const metadata: ExtractedMetadata = {
    vertexCount: 0,
    triangleCount: 0,
    meshCount: 0,
    materialCount: 0,
    hasTextures: false,
    boundingBox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
    thumbSource: 'image',
    materialNames: [],
    imageWidth: width,
    imageHeight: height
  };

  return { png, metadata };
}

async function decodeAudioBuffer(buffer: Buffer): Promise<AudioBuffer> {
  const AudioContextCtor: typeof AudioContext =
    (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new AudioContextCtor();

  try {
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return await ctx.decodeAudioData(ab);
  } finally {
    void ctx.close();
  }
}

function drawWaveform(ctx2d: CanvasRenderingContext2D, buffer: AudioBuffer, size: number): void {
  ctx2d.fillStyle = '#101113';
  ctx2d.fillRect(0, 0, size, size);

  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  const mixed = new Float32Array(length);
  for (let c = 0; c < channelCount; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mixed[i] += data[i] / channelCount;
  }

  const padding = 12;
  const drawWidth = size - padding * 2;
  const midY = size / 2;
  const maxBarHeight = size / 2 - padding;
  const samplesPerPixel = Math.max(1, Math.floor(length / drawWidth));

  ctx2d.fillStyle = '#818cf8';
  for (let x = 0; x < drawWidth; x++) {
    const start = x * samplesPerPixel;
    const end = Math.min(length, start + samplesPerPixel);
    if (end <= start) continue;
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      const v = mixed[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yTop = midY - Math.max(0.02, max) * maxBarHeight;
    const yBottom = midY - Math.min(-0.02, min) * maxBarHeight;
    ctx2d.fillRect(padding + x, yTop, 1, Math.max(1, yBottom - yTop));
  }
}

async function renderAudioThumbnail(req: ThumbRenderRequest): Promise<RenderOutput> {
  const buffer = await fs.readFile(req.absPath);
  const size = THUMB_WORKER_RENDER_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('2D context unavailable for audio thumbnail');

  let durationSec = 0;
  let sampleRate = 0;
  let channels = 0;

  try {
    const audioBuffer = await decodeAudioBuffer(buffer);
    durationSec = audioBuffer.duration;
    sampleRate = audioBuffer.sampleRate;
    channels = audioBuffer.numberOfChannels;
    drawWaveform(ctx2d, audioBuffer, size);
  } catch (err) {
    log.error('audio decode failed, falling back to placeholder tile', {
      absPath: req.absPath,
      err: (err as Error).message ?? String(err)
    });
    ctx2d.fillStyle = '#101113';
    ctx2d.fillRect(0, 0, size, size);
    ctx2d.fillStyle = '#818cf8';
    ctx2d.font = 'bold 16px sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText(`.${req.ext.toUpperCase()}`, size / 2, size / 2 - 8);
    ctx2d.fillStyle = '#6b7280';
    ctx2d.font = '12px sans-serif';
    ctx2d.fillText('Audio File', size / 2, size / 2 + 14);
  }

  const outBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!outBlob) throw new Error('canvas.toBlob returned null for audio thumbnail');
  const png = new Uint8Array(await outBlob.arrayBuffer());

  const metadata: ExtractedMetadata = {
    vertexCount: 0,
    triangleCount: 0,
    meshCount: 0,
    materialCount: 0,
    hasTextures: false,
    boundingBox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
    thumbSource: 'audio',
    materialNames: [],
    audio: durationSec > 0 ? { durationSec, sampleRate, channels } : undefined
  };

  return { png, metadata };
}

/** Document/Text preview generator: fills thumbnail box with crisp, readable text preview */
async function renderDocumentThumbnail(req: ThumbRenderRequest): Promise<RenderOutput> {
  const size = THUMB_WORKER_RENDER_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('2D context unavailable for document thumbnail');

  // Background
  ctx2d.fillStyle = '#101113';
  ctx2d.fillRect(0, 0, size, size);

  // Document Page Card
  const pad = 12;
  const cardW = size - pad * 2;
  const cardH = size - pad * 2;

  ctx2d.fillStyle = '#18191c';
  ctx2d.strokeStyle = '#2d2f36';
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath();
  ctx2d.roundRect(pad, pad, cardW, cardH, 8);
  ctx2d.fill();
  ctx2d.stroke();

  // Document Header Bar
  const headerH = 30;
  ctx2d.fillStyle = '#22242a';
  ctx2d.beginPath();
  ctx2d.roundRect(pad, pad, cardW, headerH, [8, 8, 0, 0]);
  ctx2d.fill();

  // Extension Badge
  ctx2d.fillStyle = '#3b82f6';
  ctx2d.font = 'bold 12px sans-serif';
  ctx2d.textAlign = 'left';
  ctx2d.fillText(`.${req.ext.toUpperCase()}`, pad + 10, pad + 19);

  // File Label
  ctx2d.fillStyle = '#8b8e98';
  ctx2d.font = '10px sans-serif';
  ctx2d.textAlign = 'right';
  ctx2d.fillText('DOCUMENT', size - pad - 10, pad + 19);

  // Read & render actual text content snippet
  try {
    const rawText = await fs.readFile(req.absPath, 'utf8');
    const lines = rawText
      .replace(/\r/g, '')
      .split('\n')
      .filter((l) => l.trim().length > 0);

    ctx2d.fillStyle = '#d1d5db';
    ctx2d.font = '11px system-ui, -apple-system, sans-serif';
    ctx2d.textAlign = 'left';

    let y = pad + headerH + 18;
    const maxLines = Math.floor((cardH - headerH - 16) / 16);
    const lineX = pad + 12;
    const maxLineWidth = cardW - 24;

    let lineCount = 0;
    for (const line of lines) {
      if (lineCount >= maxLines) break;

      let displayLine = line.trim();
      while (ctx2d.measureText(displayLine).width > maxLineWidth && displayLine.length > 0) {
        displayLine = displayLine.slice(0, -1);
      }
      if (displayLine.length < line.trim().length && displayLine.length > 3) {
        displayLine = displayLine.slice(0, -2) + '…';
      }

      ctx2d.fillText(displayLine, lineX, y);
      y += 16;
      lineCount++;
    }
  } catch {
    ctx2d.fillStyle = '#6b7280';
    ctx2d.font = '12px sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('Preview unavailable', size / 2, size / 2 + 10);
  }

  const outBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!outBlob) throw new Error('canvas.toBlob returned null for document thumbnail');
  const png = new Uint8Array(await outBlob.arrayBuffer());

  const metadata: ExtractedMetadata = {
    vertexCount: 0,
    triangleCount: 0,
    meshCount: 0,
    materialCount: 0,
    hasTextures: false,
    boundingBox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
    thumbSource: 'document',
    materialNames: []
  };

  return { png, metadata };
}

async function renderToPng(req: ThumbRenderRequest): Promise<RenderOutput> {
  const ext = req.ext.toLowerCase();

  if (isImageExtension(ext)) {
    return renderImageThumbnail(req);
  }

  if (isAudioExtension(ext)) {
    return renderAudioThumbnail(req);
  }

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return renderDocumentThumbnail(req);
  }

  if (!KNOWN_3D_EXTENSIONS.has(ext)) {
    log.info(`unhandled file type .${ext}, using document fallback tile`, { absPath: req.absPath });
    return renderDocumentThumbnail(req);
  }

  const buffer = await fs.readFile(req.absPath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  if (ext === '3mf') {
    const embedded = extract3MFEmbeddedThumbnail(arrayBuffer);
    if (embedded) {
      return { png: embedded, metadata: thumbnailOnlyMetadata('3mf-embedded') };
    }
  }

  const obj = await loadModel(arrayBuffer, req.ext, resolveGltfResource(req.absPath), req.orientation);
  const r = getRenderer();
  const scene = new THREE.Scene();
  const lighting = new LightingRig(scene, r);
  lighting.apply((req.lightingStyle as LightingStyle | undefined) ?? DEFAULT_LIGHTING_STYLE);
  scene.add(obj);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  frameObject(camera, obj);

  r.render(scene, camera);

  const blob = await new Promise<Blob | null>((resolve) =>
    r.domElement.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('canvas.toBlob returned null');
  const png = new Uint8Array(await blob.arrayBuffer());

  const validation = validateScene(obj);
  const meshVolumeMm3 = computeMeshVolume(obj);
  const printability = computePrintability(obj, validation);
  const format = extractFormatMetadata(arrayBuffer, req.ext);
  const metadata = extractMetadata(
    obj,
    'model',
    validation,
    meshVolumeMm3,
    printability,
    format
  );

  disposeObject(obj);
  lighting.dispose();
  scene.clear();
  return { png, metadata };
}

ipcRenderer.on(THUMB_WORKER_CHANNEL.render, async (_e, req: ThumbRenderRequest) => {
  let result: ThumbRenderResult;
  try {
    const { png, metadata } = await renderToPng(req);
    result = {
      jobId: req.jobId,
      ok: true,
      png,
      metadata,
      jobsRendered: ++jobsRendered
    };
  } catch (err) {
    log.error('render failed', {
      jobId: req.jobId,
      absPath: req.absPath,
      ext: req.ext,
      err: (err as Error).message ?? String(err)
    });
    result = {
      jobId: req.jobId,
      ok: false,
      error: (err as Error).message ?? String(err),
      jobsRendered: ++jobsRendered
    };
  }
  ipcRenderer.send(THUMB_WORKER_CHANNEL.result, result);
});

ipcRenderer.send(THUMB_WORKER_CHANNEL.ready);
log.info('worker started');