import type { Theme } from './types';

/**
 * Dark theme — neutral black built around #151515. The dark-N values are
 * set BOTH in `colors` and as --mantine-color-dark-N in `cssVars`; the
 * cssVars are what the components actually paint with (same pattern as
 * light.ts).
 */
const BLACK = '#151515';

const dark: Theme = {
  id: 'dark',
  label: 'Dark',
  colorScheme: 'dark',

  colors: {
    'dark-4': '#2a2a2a', // borders, dividers
    'dark-5': '#1d1d1d', // hover/active rows
    'dark-6': BLACK,     // secondary surfaces
    'dark-7': BLACK,     // toolbar / card backgrounds
    'dark-8': BLACK,     // primary background

    'text-primary': '#d4d4d4',
    'text-dimmed': '#8c8c8c',
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
    '--mantine-color-dark-4': '#2a2a2a',
    '--mantine-color-dark-5': '#1d1d1d',
    '--mantine-color-dark-6': BLACK,
    '--mantine-color-dark-7': BLACK,
    '--mantine-color-dark-8': BLACK,
    '--mantine-color-body': BLACK,

    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.35',
    '--wh3d-viewport-bg': '#101010',
    '--wh3d-slider-track': 'rgba(255,255,255,0.1)',
    '--wh3d-slider-thumb-bg': '#4c6ef5',
    '--wh3d-slider-thumb-border': '#ffffff',
    '--wh3d-waveform-filter': 'brightness(1.2)',
    '--wh3d-waveform-played': '#4c6ef5',
    '--wh3d-waveform-unplayed': 'rgba(255,255,255,0.25)',
    '--wh3d-overlay-bg': 'rgba(21,21,21,0.88)',
    '--wh3d-overlay-border': '#2a2a2a',
    '--wh3d-viz-top': '#a5b4fc',
    '--wh3d-viz-mid': '#7c83f5'
  }
};

export default dark;