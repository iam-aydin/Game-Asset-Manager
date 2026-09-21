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
  'bmp',
  'psd',
  'tiff',
  'tif'
] as const;

export const SUPPORTED_EXTENSIONS = [
  ...MODEL_EXTENSIONS,
  ...IMAGE_EXTENSIONS
] as const;

export type ModelExtension = (typeof MODEL_EXTENSIONS)[number];
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

const EXT_SET = new Set<string>(SUPPORTED_EXTENSIONS);
const MODEL_SET = new Set<string>(MODEL_EXTENSIONS);
const IMAGE_SET = new Set<string>(IMAGE_EXTENSIONS);

export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return EXT_SET.has(ext.toLowerCase());
}

export function isModelExtension(ext: string): ext is ModelExtension {
  return MODEL_SET.has(ext.toLowerCase());
}

export function isImageExtension(ext: string): ext is ImageExtension {
  return IMAGE_SET.has(ext.toLowerCase());
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}