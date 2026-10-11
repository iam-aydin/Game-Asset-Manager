import type { Theme } from './types';

/**
 * Cyberpunk theme — pure black (#000) with DIM yellow structure lines and
 * neon accents. Full-brightness yellow on every divider reads as loud and
 * flat, so borders are a dark yellow and the bright #fcee0a is saved for
 * small highlights (slider thumb, waveform, overlay edge).
 *
 *   dark-4                      -> dividers / panel borders (dim yellow)
 *   --mantine-color-default-border -> input / button borders (a bit brighter)
 *   indigo scale                -> primary accent (neon magenta)
 *   blue scale                  -> links / secondary accent (neon cyan)
 *
 * The indigo/blue scales and Mantine's primary-color vars are overridden in
 * `cssVars` because the components paint with those, not just `colors`.
 */
const BLACK = '#000000';
const YELLOW = '#fcee0a';
const LINE = '#3b370a';        // dividers
const LINE_STRONG = '#6b640c'; // inputs / buttons
const ROW = '#14120a';         // hover / selected rows

const cyberpunk: Theme = {
  id: 'cyberpunk',
  label: 'Cyberpunk',
  colorScheme: 'dark',

  colors: {
    'dark-4': LINE,
    'dark-5': ROW,
    'dark-6': BLACK,
    'dark-7': BLACK,
    'dark-8': BLACK,

    'text-primary': '#f0f0f0',
    'text-dimmed': '#9a9560',
    'gray-2': '#f5f5f5',
    'gray-3': '#e0e0e0',

    indigo: '#ff2a6d',
    teal: '#00f0ff',
    violet: '#b967ff',
    orange: '#ff9100',
    red: '#ff3b3b',
    grape: '#ff2a6d',
    green: '#05ffa1',
    yellow: YELLOW
  },

  cssVars: {
    // Surfaces + lines
    '--mantine-color-dark-4': LINE,
    '--mantine-color-dark-5': ROW,
    '--mantine-color-dark-6': BLACK,
    '--mantine-color-dark-7': BLACK,
    '--mantine-color-dark-8': BLACK,
    '--mantine-color-body': BLACK,
    '--mantine-color-default': BLACK,
    '--mantine-color-default-hover': ROW,
    '--mantine-color-default-border': LINE_STRONG,

    // Primary accent: neon magenta (replaces the leftover blue/indigo)
    '--mantine-color-indigo-0': '#ffe3ee',
    '--mantine-color-indigo-1': '#ffc2d9',
    '--mantine-color-indigo-2': '#ff99bd',
    '--mantine-color-indigo-3': '#ff70a2',
    '--mantine-color-indigo-4': '#ff4d8d',
    '--mantine-color-indigo-5': '#ff2a6d',
    '--mantine-color-indigo-6': '#e61f5f',
    '--mantine-color-indigo-7': '#c21650',
    '--mantine-color-indigo-8': '#9e0f41',
    '--mantine-color-indigo-9': '#7a0832',
    '--mantine-primary-color-filled': '#e61f5f',
    '--mantine-primary-color-filled-hover': '#ff2a6d',
    '--mantine-primary-color-light': 'rgba(255,42,109,0.15)',
    '--mantine-primary-color-light-hover': 'rgba(255,42,109,0.25)',
    '--mantine-primary-color-light-color': '#ff70a2',

    // Secondary accent: neon cyan (links, info chips)
    '--mantine-color-blue-0': '#e0fcff',
    '--mantine-color-blue-1': '#b3f8ff',
    '--mantine-color-blue-2': '#80f4ff',
    '--mantine-color-blue-3': '#4defff',
    '--mantine-color-blue-4': '#1aeaff',
    '--mantine-color-blue-5': '#00f0ff',
    '--mantine-color-blue-6': '#00d4e0',
    '--mantine-color-blue-7': '#00a8b8',
    '--mantine-color-blue-8': '#007d8f',
    '--mantine-color-blue-9': '#005263',

    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-viewport-bg': '#000000',
    '--wh3d-slider-track': 'rgba(252,238,10,0.2)',
    '--wh3d-slider-thumb-bg': '#ff2a6d',
    '--wh3d-slider-thumb-border': YELLOW,
    '--wh3d-waveform-filter': 'brightness(1.3) saturate(1.4)',
    '--wh3d-waveform-played': '#00f0ff',
    '--wh3d-waveform-unplayed': 'rgba(252,238,10,0.25)',
    '--wh3d-overlay-bg': 'rgba(0,0,0,0.9)',
    '--wh3d-overlay-border': LINE_STRONG,
    '--wh3d-viz-top': '#00f0ff',
    '--wh3d-viz-mid': '#ff2a6d'
  }
};

export default cyberpunk;