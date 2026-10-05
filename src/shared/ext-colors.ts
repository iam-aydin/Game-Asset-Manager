/**
 * One soft pastel accent per file CATEGORY (not per extension), used for the
 * format badge and placeholder tiles. Edit the four constants to retheme.
 */
const VIDEO = '#c4b5fd'; // pastel purple
const IMAGE = '#fde68a'; // pastel yellow
const AUDIO = '#a5f3fc'; // pastel cyan
const MODEL = '#fdba74'; // pastel orange
const TEXT = '#94a3b8'; // slate (unchanged)

export const EXT_COLORS: Record<string, string> = {
  // video
  mp4: VIDEO,
  webm: VIDEO,
  mkv: VIDEO,
  mov: VIDEO,
  avi: VIDEO,
  bik: VIDEO,
  // audio
  mp3: AUDIO,
  wav: AUDIO,
  flac: AUDIO,
  ogg: AUDIO,
  // text
  md: TEXT,
  txt: TEXT,
  // images
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  bmp: IMAGE,
  webp: IMAGE,
  gif: IMAGE,
  // 3D
  glb: MODEL,
  gltf: MODEL,
  obj: MODEL,
  stl: MODEL,
  fbx: MODEL,
  ply: MODEL,
  '3mf': MODEL,
  dae: MODEL,
  blend: MODEL
};

export const DEFAULT_EXT_COLOR = TEXT;

export function extColor(ext: string): string {
  return EXT_COLORS[ext.replace(/^\./, '').toLowerCase()] ?? DEFAULT_EXT_COLOR;
}