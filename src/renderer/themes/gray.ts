import type { Theme } from './types';

/**
 * Gray theme — the app's original look (formerly "dark"). These are
 * Mantine's own default `dark` shade values (indices 4-8 of the standard
 * 10-step dark scale), which is what every var(--mantine-color-dark-N)
 * in the app resolved to before custom themes existed.
 */
const gray: Theme = {
  id: 'gray',
  label: 'Gray',
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
    '--wh3d-slider-thumb-bg': '#3b5bdb',
    '--wh3d-waveform-filter': 'brightness(1.2)',
    '--wh3d-slider-thumb-border': '#ffffff',
    '--wh3d-waveform-played': '#4c6ef5',
    '--wh3d-waveform-unplayed': 'rgba(255,255,255,0.25)',
    '--wh3d-overlay-bg': 'rgba(16,17,19,0.85)',
    '--wh3d-overlay-border': '#2C2E33',
    '--wh3d-viz-top': '#a5b4fc',
    '--wh3d-viz-mid': '#7c83f5'
  }
};

export default gray;