import type { Theme } from './types';

/**
 * Pastel theme — built from the bedroom palette reference:
 *   dusty rose #c46e8b · orchid #d099d0 · pink #fecfef
 *   peach #ffcebd · sage #d9dfd3 · mist #e9e6ed
 *
 * Everything is tinted: the background is a real pastel pink (not near-white),
 * cards/strips/rows step lighter and deeper around it, borders are a soft
 * orchid-pink, the primary accent is dusty rose, and the secondary accent
 * (what used to be Mantine blue: links, chips) is orchid.
 *
 * colorScheme is 'light', so Mantine's dark-0..3 (which are LIGHT text colors
 * in dark mode) are remapped to plum text shades — otherwise secondary text
 * like "Show all models in current library" washes out against the pink.
 */
const BG = '#fddaf0';     // primary background
const CARD = '#fee7f6';   // toolbar / card backgrounds
const STRIP = '#fbcfe9';  // control strips, headers
const HOVER = '#f6bddf';  // hover / active rows
const LINE = '#e6a5cd';   // borders, dividers
const ROSE = '#c46e8b';   // primary accent
const PLUM = '#5b2a45';   // main text
const PLUM_DIM = '#8a5473';

const pastel: Theme = {
  id: 'pastel',
  label: 'Pastel',
  colorScheme: 'light',

  colors: {
    'dark-4': LINE,
    'dark-5': HOVER,
    'dark-6': STRIP,
    'dark-7': CARD,
    'dark-8': BG,

    'text-primary': PLUM,
    'text-dimmed': PLUM_DIM,
    'gray-2': '#6b3a55',
    'gray-3': '#7d4a66',

    indigo: ROSE,
    teal: '#86a88f',    // sage
    violet: '#b57fc4',  // orchid, deeper for legibility
    orange: '#ffa585',  // peach
    red: '#e0607e',
    grape: '#c07ac6',
    green: '#7bb394',
    yellow: '#f5c08a'
  },

  cssVars: {
    // Surfaces + lines
    '--mantine-color-dark-4': LINE,
    '--mantine-color-dark-5': HOVER,
    '--mantine-color-dark-6': STRIP,
    '--mantine-color-dark-7': CARD,
    '--mantine-color-dark-8': BG,
    '--mantine-color-body': BG,
    '--mantine-color-default': '#ffeef8',
    '--mantine-color-default-hover': HOVER,
    '--mantine-color-default-border': LINE,

    // Text (dark-0..3 are text shades in Mantine; make them readable on pink)
    '--mantine-color-text': PLUM,
    '--mantine-color-dimmed': PLUM_DIM,
    '--mantine-color-dark-0': '#4a2038',
    '--mantine-color-dark-1': PLUM,
    '--mantine-color-dark-2': '#6f3b58',
    '--mantine-color-dark-3': PLUM_DIM,
    '--mantine-color-anchor': '#905c93',
    // The `colors` block alone isn't applied as CSS vars, so gray-2/gray-3
    // (Mantine's default light text shades, e.g. "Show all models in current
    // library:") stayed near-white on the pink. Set them here as plum text.
    '--mantine-color-gray-2': '#6b3a55',
    '--mantine-color-gray-3': '#7d4a66',
    // Light-scheme inputs (search, tags, notes, selects) paint with
    // `white` for the fill and `gray-4` for the border. Remap both so
    // they match the pink background and orchid borders.
    '--mantine-color-white': BG,
    '--mantine-color-gray-4': LINE,

    // Primary accent: dusty rose
    '--mantine-color-indigo-0': '#fdeef4',
    '--mantine-color-indigo-1': '#f9d9e6',
    '--mantine-color-indigo-2': '#f1bcd1',
    '--mantine-color-indigo-3': '#e49bb9',
    '--mantine-color-indigo-4': '#d484a3',
    '--mantine-color-indigo-5': '#cc7897',
    '--mantine-color-indigo-6': '#c46e8b',
    '--mantine-color-indigo-7': '#a85a75',
    '--mantine-color-indigo-8': '#8c4960',
    '--mantine-color-indigo-9': '#6f394c',
    '--mantine-primary-color-filled': '#c46e8b',
    '--mantine-primary-color-filled-hover': '#b86482',
    '--mantine-primary-color-light': 'rgba(196,110,139,0.18)',
    '--mantine-primary-color-light-hover': 'rgba(196,110,139,0.28)',
    '--mantine-primary-color-light-color': '#a85a75',

    // Secondary accent: orchid (links, info chips)
    '--mantine-color-blue-0': '#faf0fa',
    '--mantine-color-blue-1': '#f1dcf1',
    '--mantine-color-blue-2': '#e6c3e6',
    '--mantine-color-blue-3': '#dcaedc',
    '--mantine-color-blue-4': '#d099d0',
    '--mantine-color-blue-5': '#c185c3',
    '--mantine-color-blue-6': '#a96fae',
    '--mantine-color-blue-7': '#905c93',
    '--mantine-color-blue-8': '#764a78',
    '--mantine-color-blue-9': '#5c395e',

    // Same waveform treatment as light.ts (light background)
    '--wh3d-waveform-blend': 'screen',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-waveform-filter': 'grayscale(1) invert(1) brightness(1.05)',
    '--wh3d-viewport-bg': '#fbd2ea',
    '--wh3d-slider-track': LINE,
    '--wh3d-slider-thumb-bg': '#ffffff',
    '--wh3d-slider-thumb-border': ROSE,
    '--wh3d-waveform-played': ROSE,
    '--wh3d-waveform-unplayed': 'rgba(196,110,139,0.25)',
    '--wh3d-overlay-bg': 'rgba(253,218,240,0.88)',
    '--wh3d-overlay-border': LINE,
    // Audio visualizer bars: orchid -> rose pink
    '--wh3d-viz-top': '#c58bd0',
    '--wh3d-viz-mid': '#e58db0'
  }
};

export default pastel;