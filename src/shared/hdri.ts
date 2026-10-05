/**
 * HDRI environment ids for the 3D viewer. Only the IDs live here (shared with
 * preferences); the visual definitions (file, intensities, exposure) live in
 * `src/renderer/three/hdri-presets.ts`.
 *
 *   none    the viewer as it was before: dark background, built-in studio light
 *   day     bright outdoor sky
 *   sunset  warm low sun
 *   night   dark sky, dim cool light
 */
export const HDRI_IDS = ['none', 'day', 'sunset', 'night'] as const;

export type HdriId = (typeof HDRI_IDS)[number];

export const DEFAULT_HDRI: HdriId = 'none';

export function isHdriId(value: unknown): value is HdriId {
  return typeof value === 'string' && (HDRI_IDS as readonly string[]).includes(value);
}