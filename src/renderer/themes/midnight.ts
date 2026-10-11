import type { Theme } from './types';

/**
 * Midnight theme — near-black with a blue cast, built around #4c6ef5.
 *
 * Main color is #4c6ef50a (the main color at 4% alpha). Translucent colors
 * can't be used as Mantine surface fills (they'd show whatever is behind the
 * window), so every surface is the main color composited over black at
 * stepped alphas — dark-8 is exactly #4c6ef50a over black (#03040a), and each
 * step up is a little more of the main color, so everything shares one tint.
 *
 * Same wiring as the other themes: dark-N set in both `colors` and `cssVars`
 * (cssVars are what components paint with), tinted text shades, and the
 * indigo/blue scales remapped so every accent comes from this palette.
 *
 *   dark-8 primary bg · dark-7 toolbar/cards · dark-6 strips/inputs
 *   dark-5 hover rows · dark-4 borders, dividers
 */
const MAIN = '#4c6ef5';
const D8 = '#03040a';
const D7 = '#05070f';
const D6 = '#060914';
const D5 = '#0a0e20';
const D4 = '#0f1631';
const TEXT = '#cbcfe2';
const DIM = '#8d94b0';

const midnight: Theme = {
  id: 'midnight',
  label: 'Midnight',
  colorScheme: 'dark',

  colors: {
    'dark-4': D4,
    'dark-5': D5,
    'dark-6': D6,
    'dark-7': D7,
    'dark-8': D8,

    'text-primary': TEXT,
    'text-dimmed': DIM,
    'gray-2': '#e4e7f1',
    'gray-3': TEXT,

    indigo: MAIN,
    teal: '#22c3b0',
    violet: '#8b7cf6',
    orange: '#f59e4a',
    red: '#f0626b',
    grape: '#c26bd9',
    green: '#4ade80',
    yellow: '#f2c94c'
  },

  cssVars: {
    '--wh3d-main': '#4c6ef50a',

    // Surfaces + lines
    '--mantine-color-dark-4': D4,
    '--mantine-color-dark-5': D5,
    '--mantine-color-dark-6': D6,
    '--mantine-color-dark-7': D7,
    '--mantine-color-dark-8': D8,
    '--mantine-color-body': D8,
    '--mantine-color-default': D6,
    '--mantine-color-default-hover': D5,
    '--mantine-color-default-border': D4,

    // Text
    '--mantine-color-text': TEXT,
    '--mantine-color-dimmed': DIM,
    '--mantine-color-dark-0': TEXT,
    '--mantine-color-dark-1': '#a8aec7',
    '--mantine-color-dark-2': DIM,
    '--mantine-color-dark-3': '#5e6582',
    '--mantine-color-gray-2': '#e4e7f1',
    '--mantine-color-gray-3': TEXT,
    '--mantine-color-anchor': '#91a7ff',

    // Primary accent: indigo blue
    '--mantine-color-indigo-0': '#edf2ff',
    '--mantine-color-indigo-1': '#dbe4ff',
    '--mantine-color-indigo-2': '#bac8ff',
    '--mantine-color-indigo-3': '#91a7ff',
    '--mantine-color-indigo-4': '#748ffc',
    '--mantine-color-indigo-5': '#5c7cfa',
    '--mantine-color-indigo-6': '#4c6ef5',
    '--mantine-color-indigo-7': '#4263eb',
    '--mantine-color-indigo-8': '#3b5bdb',
    '--mantine-color-indigo-9': '#364fc7',
    '--mantine-primary-color-filled': MAIN,
    '--mantine-primary-color-filled-hover': '#5c7cfa',
    '--mantine-primary-color-light': 'rgba(76,110,245,0.16)',
    '--mantine-primary-color-light-hover': 'rgba(76,110,245,0.26)',
    '--mantine-primary-color-light-color': '#91a7ff',

    // Secondary accent: indigo (lighter shades) (links, info chips)
    '--mantine-color-blue-0': '#edf2ff',
    '--mantine-color-blue-1': '#dbe4ff',
    '--mantine-color-blue-2': '#bac8ff',
    '--mantine-color-blue-3': '#91a7ff',
    '--mantine-color-blue-4': '#748ffc',
    '--mantine-color-blue-5': '#5c7cfa',
    '--mantine-color-blue-6': '#4c6ef5',
    '--mantine-color-blue-7': '#4263eb',
    '--mantine-color-blue-8': '#3b5bdb',
    '--mantine-color-blue-9': '#364fc7',

    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.35',
    '--wh3d-waveform-filter': 'brightness(1.2)',
    '--wh3d-viewport-bg': '#020307',
    '--wh3d-slider-track': 'rgba(76,110,245,0.22)',
    '--wh3d-slider-thumb-bg': MAIN,
    '--wh3d-slider-thumb-border': '#ffffff',
    '--wh3d-waveform-played': '#c084fc',
    '--wh3d-waveform-unplayed': 'rgba(186,200,255,0.25)',
    '--wh3d-overlay-bg': 'rgba(3,4,10,0.88)',
    '--wh3d-overlay-border': D4,
    // Audio visualizer + player: two colors (blue ends -> violet center)
    '--wh3d-viz-top': '#748ffc',
    '--wh3d-viz-mid': '#c084fc'
  }
};

export default midnight;