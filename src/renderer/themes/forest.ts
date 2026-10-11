import type { Theme } from './types';

/**
 * Forest theme — near-black with a green cast, built around a green of the same vividness as #4c6ef5.
 *
 * Main color is #2dbe690a (the main color at 4% alpha). Translucent colors
 * can't be used as Mantine surface fills (they'd show whatever is behind the
 * window), so every surface is the main color composited over black at
 * stepped alphas — dark-8 is exactly #2dbe690a over black (#020804), and each
 * step up is a little more of the main color, so everything shares one tint.
 *
 * Same wiring as the other themes: dark-N set in both `colors` and `cssVars`
 * (cssVars are what components paint with), tinted text shades, and the
 * indigo/blue scales remapped so every accent comes from this palette.
 *
 *   dark-8 primary bg · dark-7 toolbar/cards · dark-6 strips/inputs
 *   dark-5 hover rows · dark-4 borders, dividers
 */
const MAIN = '#2dbe69';
const D8 = '#020804';
const D7 = '#030b06';
const D6 = '#040f08';
const D5 = '#06190e';
const D4 = '#092615';
const TEXT = '#cbe2d4';
const DIM = '#8db09b';

const forest: Theme = {
  id: 'forest',
  label: 'Forest',
  colorScheme: 'dark',

  colors: {
    'dark-4': D4,
    'dark-5': D5,
    'dark-6': D6,
    'dark-7': D7,
    'dark-8': D8,

    'text-primary': TEXT,
    'text-dimmed': DIM,
    'gray-2': '#e4f1ea',
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
    '--wh3d-main': '#2dbe690a',

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
    '--mantine-color-dark-1': '#a8c7b5',
    '--mantine-color-dark-2': DIM,
    '--mantine-color-dark-3': '#5e826d',
    '--mantine-color-gray-2': '#e4f1ea',
    '--mantine-color-gray-3': TEXT,
    '--mantine-color-anchor': '#83e2ab',

    // Primary accent: forest green
    '--mantine-color-indigo-0': '#effaf4',
    '--mantine-color-indigo-1': '#d7f4e3',
    '--mantine-color-indigo-2': '#b0e8c7',
    '--mantine-color-indigo-3': '#83e2ab',
    '--mantine-color-indigo-4': '#5ad88e',
    '--mantine-color-indigo-5': '#3dd17b',
    '--mantine-color-indigo-6': '#2dbe69',
    '--mantine-color-indigo-7': '#26a159',
    '--mantine-color-indigo-8': '#1f8449',
    '--mantine-color-indigo-9': '#186739',
    '--mantine-primary-color-filled': MAIN,
    '--mantine-primary-color-filled-hover': '#3dd17b',
    '--mantine-primary-color-light': 'rgba(45,190,105,0.16)',
    '--mantine-primary-color-light-hover': 'rgba(45,190,105,0.26)',
    '--mantine-primary-color-light-color': '#83e2ab',

    // Secondary accent: green (lighter shades) (links, info chips)
    '--mantine-color-blue-0': '#effaf4',
    '--mantine-color-blue-1': '#d7f4e3',
    '--mantine-color-blue-2': '#b0e8c7',
    '--mantine-color-blue-3': '#83e2ab',
    '--mantine-color-blue-4': '#5ad88e',
    '--mantine-color-blue-5': '#3dd17b',
    '--mantine-color-blue-6': '#2dbe69',
    '--mantine-color-blue-7': '#26a159',
    '--mantine-color-blue-8': '#1f8449',
    '--mantine-color-blue-9': '#186739',

    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.35',
    '--wh3d-waveform-filter': 'brightness(1.2)',
    '--wh3d-viewport-bg': '#010603',
    '--wh3d-slider-track': 'rgba(45,190,105,0.22)',
    '--wh3d-slider-thumb-bg': MAIN,
    '--wh3d-slider-thumb-border': '#ffffff',
    '--wh3d-waveform-played': '#f2c94c',
    '--wh3d-waveform-unplayed': 'rgba(176,232,199,0.25)',
    '--wh3d-overlay-bg': 'rgba(2,8,4,0.88)',
    '--wh3d-overlay-border': D4,
    // Audio visualizer + player: two colors (green ends -> gold center)
    '--wh3d-viz-top': '#3ddc84',
    '--wh3d-viz-mid': '#f2c94c'
  }
};

export default forest;