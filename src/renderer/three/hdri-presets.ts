/**
 * HDRI presets — pure data. Drop the Poly Haven files in
 * `src/renderer/three/hdri/` as day.hdr, sunset.hdr and night.hdr.
 *
 * Vite turns each `new URL(..., import.meta.url)` into a bundled asset, so the
 * files ship inside the app and load from its own origin.
 *
 * Tune the numbers per file; every HDRI has a different brightness:
 *   environmentIntensity  how strongly the HDRI lights the model (Lit only)
 *   backgroundIntensity   brightness of the sky shown behind the model
 *   backgroundBlurriness  0..1. Keep it 0: any value above 0 makes three.js draw the sky
 *                        from a prefiltered cube map, which looks softer and blockier.
 *                        Use a bigger .hdr (2K / 4K) for a sharper sky instead.
 *   exposure              tone-mapping exposure while this HDRI is active
 *   lightScale            multiplier on the built-in key / fill / rim lights while
 *                         this HDRI is active (so Night isn't lit like a studio)
 *
 * Do NOT import this file from the thumbnail worker; thumbnails never use HDRIs.
 */
import type { HdriId } from '@shared/hdri';

export interface HdriPresetDefinition {
  id: HdriId;
  label: string;
  /** null = no HDRI (the original look). */
  url: string | null;
  environmentIntensity: number;
  backgroundIntensity: number;
  backgroundBlurriness: number;
  exposure: number;
  lightScale: number;
}

export const NONE_HDRI: HdriPresetDefinition = {
  id: 'none',
  label: 'None',
  url: null,
  environmentIntensity: 1,
  backgroundIntensity: 1,
  backgroundBlurriness: 0,
  exposure: 0.85,
  lightScale: 1
};

export const DAY_HDRI: HdriPresetDefinition = {
  id: 'day',
  label: 'Day',
  url: new URL('./hdri/day.hdr', import.meta.url).href,
  environmentIntensity: 1.0,
  backgroundIntensity: 1.0,
  backgroundBlurriness: 0,
  exposure: 0.9,
  lightScale: 0.4
};

export const SUNSET_HDRI: HdriPresetDefinition = {
  id: 'sunset',
  label: 'Sunset',
  url: new URL('./hdri/sunset.hdr', import.meta.url).href,
  environmentIntensity: 1.0,
  backgroundIntensity: 1.0,
  backgroundBlurriness: 0,
  exposure: 0.9,
  lightScale: 0.3
};

export const NIGHT_HDRI: HdriPresetDefinition = {
  id: 'night',
  label: 'Night',
  url: new URL('./hdri/night.hdr', import.meta.url).href,
  environmentIntensity: 2.0,
  backgroundIntensity: 1.0,
  backgroundBlurriness: 0,
  exposure: 1.0,
  lightScale: 0.05
};

/** Order here is the order of the segmented control in the UI. */
export const HDRI_PRESETS: readonly HdriPresetDefinition[] = [
  NONE_HDRI,
  DAY_HDRI,
  SUNSET_HDRI,
  NIGHT_HDRI
];

const PRESETS_BY_ID: Record<HdriId, HdriPresetDefinition> = {
  none: NONE_HDRI,
  day: DAY_HDRI,
  sunset: SUNSET_HDRI,
  night: NIGHT_HDRI
};

export function getHdriPreset(id: HdriId): HdriPresetDefinition {
  return PRESETS_BY_ID[id];
}