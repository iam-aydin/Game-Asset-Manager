/**
 * View-mode identifiers shared between renderer (LightingRig implementation,
 * ModelViewer material swapping, UI picker) and main / worker (passed through
 * IPC + render requests).
 *
 * The type is still called `LightingStyle` so the IPC contracts, preload
 * bridge, and thumbnail worker protocol didn't have to change. The values are
 * Unreal-style viewport modes, in the order they appear in the UI:
 *
 *   unlit     flat base color / textures, no lighting
 *   wireframe mesh edges only
 *   lit       full lighting (key / fill / rim + reflections)
 *   normals   world-space surface normals as colors
 *
 * Only the IDs live here — the visual definitions (label, description,
 * lights, exposure, etc.) live in `src/renderer/three/lighting-presets.ts`
 * so they can be tweaked in isolation without touching IPC contracts.
 */

export const LIGHTING_STYLE_IDS = [
  'unlit',
  'wireframe',
  'lit',
  'normals'
] as const;

export type LightingStyle = (typeof LIGHTING_STYLE_IDS)[number];

export const DEFAULT_LIGHTING_STYLE: LightingStyle = 'lit';

/**
 * Also used to validate values read back from localStorage / IPC. Old saved
 * ids ('studio', 'dramatic', 'product', 'outdoor') fail this check and fall
 * back to the default.
 */
export function isLightingStyle(value: unknown): value is LightingStyle {
  return typeof value === 'string' && (LIGHTING_STYLE_IDS as readonly string[]).includes(value);
}