/**
 * View-mode presets — pure data.
 *
 * All four modes deliberately share the SAME light rig (the former "Studio"
 * setup). What makes Unlit / Wireframe / Normals look different is the
 * material swap done by `view-modes.ts` in ModelViewer — those materials
 * ignore lights anyway. Sharing one rig means the thumbnail worker, which
 * only applies lights and never swaps materials, always renders a normal lit
 * thumbnail no matter which mode id it receives.
 *
 * Adding a mode means:
 *   1. Add an ID to `LIGHTING_STYLE_IDS` in `src/shared/lighting-types.ts`
 *   2. Add a const here and append to `LIGHTING_PRESETS` + `PRESETS_BY_ID`
 *   3. Handle the id in `applyViewMode` in `view-modes.ts`
 *
 * Hex colors are RGB integers (e.g. 0xfff0e0 = warm white). Intensities are
 * physically-based; values look high because they're combined with ACES
 * Filmic tone mapping (set globally by LightingRig).
 */
import type { LightingStyle } from '@shared/lighting-types';

export interface DirectionalLightDef {
  color: number;
  intensity: number;
  /** World-space position; the light points toward the origin. */
  position: [number, number, number];
}

export interface HemisphereLightDef {
  skyColor: number;
  groundColor: number;
  intensity: number;
}

export interface AmbientLightDef {
  color: number;
  intensity: number;
}

export interface LightingPresetDefinition {
  id: LightingStyle;
  /** Short label for the UI picker. */
  label: string;
  /** One-line hint shown next to the picker. */
  description: string;
  /** Tone mapping exposure multiplier (1.0 = neutral). */
  exposure: number;
  /**
   * Strength of the baked-in RoomEnvironment IBL. 0 disables the env map
   * entirely (saves the PMREM bake); higher values brighten reflections on
   * metallic / glossy materials.
   */
  environmentIntensity: number;
  ambient?: AmbientLightDef;
  hemisphere?: HemisphereLightDef;
  directionals?: readonly DirectionalLightDef[];
}

// ─── Lit (the shared rig) ────────────────────────────────────────────────

export const LIT_PRESET: LightingPresetDefinition = {
  id: 'lit',
  label: 'Lit',
  description: 'Full lighting: warm key, cool fill and rim light with soft reflections.',
  exposure: 0.85,
  environmentIntensity: 0.4,
  ambient: { color: 0xffffff, intensity: 0.2 },
  directionals: [
    // Key: warm, front-right, well above — strong downward angle so shadows
    // fall onto whatever's underneath the geometry.
    { color: 0xfff0e0, intensity: 3.0, position: [2.5, 6, 2.5] },
    // Fill: cool, opposite side, lower
    { color: 0xb8d4ff, intensity: 1.0, position: [-3, 0.5, 1.5] },
    // Rim: cool-white from behind, picks out silhouette
    { color: 0xeaf0ff, intensity: 1.85, position: [-1, 2.5, -3] }
  ]
};

// ─── Unlit ───────────────────────────────────────────────────────────────

export const UNLIT_PRESET: LightingPresetDefinition = {
  ...LIT_PRESET,
  id: 'unlit',
  label: 'Unlit',
  description: 'Flat base color and textures with no lighting.'
};

// ─── Wireframe ───────────────────────────────────────────────────────────

export const WIREFRAME_PRESET: LightingPresetDefinition = {
  ...LIT_PRESET,
  id: 'wireframe',
  label: 'Wireframe',
  description: 'Mesh edges only. Useful for checking topology and triangle density.'
};

// ─── Normals ─────────────────────────────────────────────────────────────

export const NORMALS_PRESET: LightingPresetDefinition = {
  ...LIT_PRESET,
  id: 'normals',
  label: 'Normals',
  description: 'World-space surface normals as colors. Useful for spotting flipped faces.'
};

// ─── registry ────────────────────────────────────────────────────────────

/** Order here is the order of the segmented control in the UI. */
export const LIGHTING_PRESETS: readonly LightingPresetDefinition[] = [
  UNLIT_PRESET,
  WIREFRAME_PRESET,
  LIT_PRESET,
  NORMALS_PRESET
];

const PRESETS_BY_ID: Record<LightingStyle, LightingPresetDefinition> = {
  unlit: UNLIT_PRESET,
  wireframe: WIREFRAME_PRESET,
  lit: LIT_PRESET,
  normals: NORMALS_PRESET
};

export function getLightingPreset(id: LightingStyle): LightingPresetDefinition {
  return PRESETS_BY_ID[id];
}