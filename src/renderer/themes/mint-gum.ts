import type { Theme } from './types';

/**
 * Mint Gum - fresh mint green + bubble-gum pink on soft green-tinted white.
 * A light-mode take on the Cyberpunk recipe:
 *
 *   dark-4                         -> dividers / panel borders (soft mint)
 *   --mantine-color-default-border -> input / button borders (stronger mint)
 *   indigo scale                   -> primary accent (mint green)
 *   blue scale                     -> links / secondary accent (bubble-gum pink)
 *
 * The indigo steps 1-3 are dark greens on purpose: the app uses them as TEXT
 * colors (breadcrumbs, active links), which must read on a light background.
 */
const BODY = '#f3fcf6';
const LINE = '#a8dfbd';        // dividers
const LINE_STRONG = '#7fcfa0'; // inputs / buttons
const ROW = '#d6f3e0';         // hover / selected rows
const GUM = '#8fe3b0';

const mintGum: Theme = {
  id: 'mint-gum',
  label: 'Mint Gum',
  colorScheme: 'light',

  colors: {
    'dark-4': LINE,
    'dark-5': ROW,
    'dark-6': '#e6f8ec',
    'dark-7': '#eefaf2',
    'dark-8': BODY,

    'text-primary': '#12301f',
    'text-dimmed': '#5b7a68',
    'gray-2': '#1f4a33',
    'gray-3': '#2d5f45',

    indigo: '#0f9d58',
    teal: '#12b886',
    violet: '#9775fa',
    orange: '#fd7e14',
    red: '#e03131',
    grape: GUM,
    green: '#2f9e44',
    yellow: '#f08c00'
  },

  cssVars: {
    // Surfaces + lines
    '--mantine-color-text': '#12301f',
    '--mantine-color-dimmed': '#5b7a68',
    '--mantine-color-gray-2': '#1f4a33',
    '--mantine-color-gray-3': '#2d5f45',
    '--mantine-color-dark-4': LINE,
    '--mantine-color-dark-5': ROW,
    '--mantine-color-dark-6': '#e6f8ec',
    '--mantine-color-dark-7': '#eefaf2',
    '--mantine-color-dark-8': BODY,
    '--mantine-color-body': BODY,
    '--mantine-color-default': '#ffffff',
    '--mantine-color-default-hover': ROW,
    '--mantine-color-default-border': LINE_STRONG,

    // Primary accent: mint green (1-3 darkened for text legibility)
    '--mantine-color-indigo-0': '#e6fcf0',
    '--mantine-color-indigo-1': '#0a5c35',
    '--mantine-color-indigo-2': '#0b6b3e',
    '--mantine-color-indigo-3': '#117a48',
    '--mantine-color-indigo-4': '#18a058',
    '--mantine-color-indigo-5': '#12a150',
    '--mantine-color-indigo-6': '#0f9d58',
    '--mantine-color-indigo-7': '#0c8449',
    '--mantine-color-indigo-8': '#096b3b',
    '--mantine-color-indigo-9': '#06522d',
    '--mantine-primary-color-filled': '#0f9d58',
    '--mantine-primary-color-filled-hover': '#0c8449',
    '--mantine-primary-color-light': 'rgba(15,157,88,0.14)',
    '--mantine-primary-color-light-hover': 'rgba(15,157,88,0.22)',
    '--mantine-primary-color-light-color': '#0b6b3e',

    // Secondary accent: bubble-gum pink (links, info chips)
    '--mantine-color-blue-0': '#fff0f6',
    '--mantine-color-blue-1': '#ffdeeb',
    '--mantine-color-blue-2': '#fcc2d7',
    '--mantine-color-blue-3': '#faa2c1',
    '--mantine-color-blue-4': '#f783ac',
    '--mantine-color-blue-5': '#f06595',
    '--mantine-color-blue-6': '#e64980',
    '--mantine-color-blue-7': '#d6336c',
    '--mantine-color-blue-8': '#b02a5b',
    '--mantine-color-blue-9': '#8c1f48',

    // App-specific (blend/filter approach copied from the Light theme)
    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-waveform-filter': 'brightness(1.05) saturate(1.1)',
    '--wh3d-waveform-played': '#12a150',
    '--wh3d-waveform-unplayed': 'rgba(143,227,176,0.65)',
    '--wh3d-viewport-bg': '#dff5e7',
    '--wh3d-slider-track': '#b8edcc',
    '--wh3d-slider-thumb-bg': '#ffffff',
    '--wh3d-slider-thumb-border': '#8fe3b0',
    '--wh3d-overlay-bg': 'rgba(243,252,246,0.88)',
    '--wh3d-overlay-border': LINE_STRONG,
    '--wh3d-viz-top': '#b8edcc',
    '--wh3d-viz-mid': '#0f9d58'
  }
};

export default mintGum;