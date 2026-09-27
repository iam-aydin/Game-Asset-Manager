import type { Theme } from './types';

const modules = import.meta.glob<{ default: Theme }>('./*.ts', { eager: true });

export const THEMES: Theme[] = Object.entries(modules)
  .filter(([path]) => !path.endsWith('/index.ts') && !path.endsWith('/types.ts'))
  .map(([, mod]) => mod.default)
  .filter((theme): theme is Theme => Boolean(theme))
  .sort((a, b) => a.label.localeCompare(b.label));

export const DEFAULT_THEME_ID = 'dark';

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? THEMES[0];
}

export type { Theme } from './types';