import type { Theme } from './types';

/**
 * Dark theme — the app's current/default look, extracted as a normal
 * themes/ entry instead of being hardcoded. These are Mantine's own default
 * `dark` shade values (indices 4-8 of the standard 10-step dark scale),
 * which is what every var(--mantine-color-dark-N) in the app already
 * resolves to today — so switching TO this theme is a no-op visually.
 */
const dark: Theme = {
  id: 'dark',
  label: 'Dark',
  colorScheme: 'dark',

  colors: {
    'dark-4': '#373A40',
    'dark-5': '#2C2E33',
    'dark-6': '#25262b',
    'dark-7': '#1A1B1E',
    'dark-8': '#141517',

    'text-primary': '#C1C2C5',
    'text-dimmed': '#909296',
    'gray-2': '#e9ecef',
    'gray-3': '#dee2e6',

    indigo: '#4c6ef5',
    teal: '#12b886',
    violet: '#7950f2',
    orange: '#fd7e14',
    red: '#fa5252',
    grape: '#be4bdb',
    green: '#40c057',
    yellow: '#fab005'
  },

  cssVars: {
    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.35',
    '--wh3d-viewport-bg': '#101113',
    '--wh3d-slider-track': 'rgba(255,255,255,0.1)',
    // Slider knob: restored to the original look (plain white interior,
    // white border — effectively an all-white circle) rather than the
    // blue/black knob added for the light theme. AudioPlayer.tsx reads
    // these two for every slider's thumb styling.
    '--wh3d-slider-thumb-bg': '#3b5bdb',
    '--wh3d-waveform-filter': 'brightness(1.2)',
    '--wh3d-slider-thumb-border': '#ffffff',
    '--wh3d-waveform-played': '#4c6ef5',
    '--wh3d-waveform-unplayed': 'rgba(255,255,255,0.25)',
    '--wh3d-overlay-bg': 'rgba(16,17,19,0.85)',
    '--wh3d-overlay-border': '#2C2E33'
  }
};

export default dark;