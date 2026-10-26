import type { Theme } from './types';

/**
 * Vampire - blood-crimson + amethyst + antique gold on near-black burgundy.
 * Same recipe as Cyberpunk, different palette:
 *
 *   dark-4                         -> dividers / panel borders (dim wine)
 *   --mantine-color-default-border -> input / button borders (brighter wine)
 *   indigo scale                   -> primary accent (blood crimson)
 *   blue scale                     -> links / secondary accent (amethyst)
 *   gold                           -> small highlights (slider thumb, waveform track)
 */
const BODY = '#0b0307';
const DEEP = '#070204';
const LINE = '#4d1226';        // dividers
const LINE_STRONG = '#7d1a3b'; // inputs / buttons
const ROW = '#1f0a14';         // hover / selected rows
const GOLD = '#a71935';

const vampire: Theme = {
  id: 'vampire',
  label: 'Vampire',
  colorScheme: 'dark',

  colors: {
    'dark-4': LINE,
    'dark-5': ROW,
    'dark-6': '#12050b',
    'dark-7': '#0e0409',
    'dark-8': BODY,

    'text-primary': '#f5e9ec',
    'text-dimmed': '#b08a95',
    'gray-2': '#f0dde2',
    'gray-3': '#e0c9cf',

    indigo: '#e03a52',
    teal: '#c084fc',
    violet: '#9d54ff',
    orange: '#ff8a3d',
    red: '#ff3b4e',
    grape: '#e03a52',
    green: '#4ade80',
    yellow: GOLD
  },

  cssVars: {
    // Surfaces + lines
    '--mantine-color-dark-0': '#f5e9ec',
    '--mantine-color-dark-1': '#e0c9cf',
    '--mantine-color-dark-2': '#c4a3ad',
    '--mantine-color-dark-3': '#9b7480',
    '--mantine-color-dark-4': LINE,
    '--mantine-color-dark-5': ROW,
    '--mantine-color-dark-6': '#12050b',
    '--mantine-color-dark-7': '#0e0409',
    '--mantine-color-dark-8': BODY,
    '--mantine-color-dark-9': DEEP,
    '--mantine-color-body': BODY,
    '--mantine-color-default': '#0e0409',
    '--mantine-color-default-hover': ROW,
    '--mantine-color-default-border': LINE_STRONG,

    // Primary accent: blood crimson
    '--mantine-color-indigo-0': '#ffe3e8',
    '--mantine-color-indigo-1': '#ffc2cd',
    '--mantine-color-indigo-2': '#ff9fb0',
    '--mantine-color-indigo-3': '#ff7a92',
    '--mantine-color-indigo-4': '#f2506d',
    '--mantine-color-indigo-5': '#e03a52',
    '--mantine-color-indigo-6': '#c9184a',
    '--mantine-color-indigo-7': '#a4133c',
    '--mantine-color-indigo-8': '#800f2f',
    '--mantine-color-indigo-9': '#590d22',
    '--mantine-primary-color-filled': '#c9184a',
    '--mantine-primary-color-filled-hover': '#e03a52',
    '--mantine-primary-color-light': 'rgba(224,58,82,0.15)',
    '--mantine-primary-color-light-hover': 'rgba(224,58,82,0.25)',
    '--mantine-primary-color-light-color': '#ff7a92',

    // Secondary accent: amethyst (links, info chips)
    '--mantine-color-blue-0': '#f3e8ff',
    '--mantine-color-blue-1': '#e2ccff',
    '--mantine-color-blue-2': '#d0adff',
    '--mantine-color-blue-3': '#bd8cff',
    '--mantine-color-blue-4': '#ab6dff',
    '--mantine-color-blue-5': '#9d54ff',
    '--mantine-color-blue-6': '#8a3df0',
    '--mantine-color-blue-7': '#7230cc',
    '--mantine-color-blue-8': '#5a26a3',
    '--mantine-color-blue-9': '#401b75',

    // App-specific
    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-waveform-filter': 'brightness(1.3) saturate(1.4)',
    '--wh3d-waveform-played': '#e03a52',
    '--wh3d-waveform-unplayed': 'rgba(125,26,59,0.45)',
    '--wh3d-viewport-bg': '#050104',
    '--wh3d-slider-track': 'rgba(125,26,59,0.35)',
    '--wh3d-slider-thumb-bg': '#e03a52',
    '--wh3d-slider-thumb-border': '#a71935',
    '--wh3d-overlay-bg': 'rgba(11,3,7,0.9)',
    '--wh3d-overlay-border': LINE_STRONG,
    '--wh3d-viz-top': '#ff2b4a',
    '--wh3d-viz-mid': '#7f0d20'
  }
};

export default vampire;