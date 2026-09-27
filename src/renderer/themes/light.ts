import type { Theme } from './types';

/**
 * Light theme — first entry in the themes/ folder.
 *
 * NOTE: dark.ts (extracting the app's CURRENT hardcoded colors as the
 * baseline/default theme) still needs to be added next, plus
 * themes/index.ts to auto-register everything in this folder and
 * themes/types.ts (the Theme interface this file imports). See the
 * TODO(theme-switcher) block left in App.tsx for the full plan.
 *
 * Values below are 1:1 replacements for every var(--mantine-color-dark-N)
 * and accent color currently hardcoded throughout the app (PreviewPane,
 * AudioPlayer, App.tsx toolbar, etc.) so wiring this in is a matter of
 * swapping CSS custom properties at the root, not touching component code.
 */
const light: Theme = {
  id: 'light',
  label: 'Light',
  colorScheme: 'light',

  colors: {
    // Previously a light-gray scale (dcdde1 → f7f8fa) that read as visible
    // gray chrome around cards/panels; flattened to solid white per request.
    // Note: borders/dividers that key off dark-4..dark-7 will now be
    // effectively invisible against the dark-8 background, since everything
    // in this range is the same white — flag if a subtle border is wanted
    // back for any specific surface.
    'dark-4': '#ffffff', // was #dcdde1 — borders, dividers
    'dark-5': '#ffffff', // was #e9eaed — hover/active row backgrounds
    'dark-6': '#ffffff', // was #f1f2f4 — secondary surfaces (control strips, headers)
    'dark-7': '#ffffff', // was #f7f8fa — toolbar / card backgrounds
    'dark-8': '#ffffff', // primary background

    // Text
    'text-primary': '#1a1b1e',
    'text-dimmed': '#6b7280',
    'gray-2': '#2c2e33',
    'gray-3': '#3f4148',

    // Accents — kept close to Mantine defaults so contrast against the
    // light background still passes; only shifted where needed for
    // legibility (e.g. indigo darkened slightly).
    indigo: '#4c51d6',
    teal: '#0c8599',
    violet: '#7048e8',
    orange: '#e8590c',
    red: '#e03131',
    grape: '#9c36b5',
    green: '#2f9e44',
    yellow: '#f08c00'
  },

  // Raw CSS custom property overrides applied at :root when this theme is
  // active — same names the app already references via
  // var(--mantine-color-dark-N), so no component changes are needed.
  cssVars: {
    '--wh3d-waveform-blend': 'screen',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-viewport-bg': '#f1f2f4',
    '--wh3d-slider-track': '#ffffff',
    // Slider knob: white interior with a black outline — plain white alone
    // would vanish against this theme's white surfaces, so the border stays
    // black for visibility. (Dark theme keeps its original all-white knob;
    // see dark.ts.)
    '--wh3d-slider-thumb-bg': '#ffffff',
    '--wh3d-slider-thumb-border': '#3b5bdb',
    '--mantine-color-dark-4': '#ffffff',
    '--mantine-color-dark-5': '#ffffff',
    '--mantine-color-dark-6': '#ffffff',
    '--mantine-color-dark-7': '#ffffff',
    '--mantine-color-dark-8': '#ffffff',
    '--wh3d-waveform-filter': 'grayscale(1) invert(1) brightness(1.05)',
    '--wh3d-waveform-played': '#3b5bdb',
    '--wh3d-waveform-unplayed': 'rgba(0,0,0,0.15)',
    '--wh3d-overlay-bg': 'rgba(255,255,255,0.85)',
    '--wh3d-overlay-border': '#dee2e6'
  }
};

export default light;