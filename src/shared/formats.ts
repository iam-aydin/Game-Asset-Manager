export const MODEL_EXTENSIONS = [
  'glb',
  'gltf',
  'obj',
  'stl',
  'fbx',
  'ply',
  '3mf'
] as const;

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'bmp'
] as const;

export const AUDIO_EXTENSIONS = [
  'wav',
  'mp3',
  'flac'
] as const;

export const TEXT_EXTENSIONS = [
  'txt',
  'md'
] as const;

export const SUPPORTED_EXTENSIONS = [
  ...MODEL_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...TEXT_EXTENSIONS
] as const;

export type ModelExtension = (typeof MODEL_EXTENSIONS)[number];
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];
export type TextExtension = (typeof TEXT_EXTENSIONS)[number];
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

const EXT_SET = new Set<string>(SUPPORTED_EXTENSIONS);
const MODEL_SET = new Set<string>(MODEL_EXTENSIONS);
const IMAGE_SET = new Set<string>(IMAGE_EXTENSIONS);
const AUDIO_SET = new Set<string>(AUDIO_EXTENSIONS);
const TEXT_SET = new Set<string>(TEXT_EXTENSIONS);

export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return EXT_SET.has(ext.toLowerCase());
}

export function isModelExtension(ext: string): ext is ModelExtension {
  return MODEL_SET.has(ext.toLowerCase());
}

export function isImageExtension(ext: string): ext is ImageExtension {
  return IMAGE_SET.has(ext.toLowerCase());
}

export function isAudioExtension(ext: string): ext is AudioExtension {
  return AUDIO_SET.has(ext.toLowerCase());
}

export function isTextExtension(ext: string): ext is TextExtension {
  return TEXT_SET.has(ext.toLowerCase());
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}