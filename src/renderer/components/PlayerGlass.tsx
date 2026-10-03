import { useComputedColorScheme } from '@mantine/core';

export const PLAYER_GLASS_CLASS = 'gam-player-glass';
export const PLAYER_GLASS_POPOVER_CLASS = 'gam-player-glass-pop';

/* Same recipe as the Filter dropdown in SearchBar.tsx: blue -> red 10% tint,
   light blur + saturation, translucent white border, inset top highlight.
   Light theme adds a white tint so dark text stays readable.

   Icon contrast: subtle (unfilled) icon buttons and "dimmed" text are forced
   to a high-contrast colour inside the glass, with a soft drop shadow on the
   icons so they pop off the translucent background in both themes. */
function buildCss(isLight: boolean): string {
  const tint = 'linear-gradient(135deg, rgba(59, 91, 219, 0.1), rgba(255, 0, 0, 0.1))';
  const bg = isLight ? `${tint}, rgba(255, 255, 255, 0.62)` : tint;
  const border = isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.22)';
  const text = isLight ? '#16171a' : '#ececee';
  const dimmed = isLight ? '#4a4d57' : '#b4b6bd';
  const hover = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)';
  const iconShadow = isLight
    ? '0 1px 1.5px rgba(0, 0, 0, 0.35)'
    : '0 1px 2px rgba(0, 0, 0, 0.6)';
  const blur = isLight ? 'blur(18px) saturate(140%)' : 'blur(14px) saturate(130%)';
  const shadow = isLight
    ? '0 0 0 1px rgba(30,40,70,0.1), 0 12px 36px rgba(30,40,70,0.18), inset 0 1px 0 rgba(255,255,255,0.9)'
    : '0 12px 36px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25)';

  return `
.${PLAYER_GLASS_CLASS},
.${PLAYER_GLASS_POPOVER_CLASS} {
  background: ${bg} !important;
  -webkit-backdrop-filter: ${blur};
  backdrop-filter: ${blur};
  border: 1px solid ${border} !important;
  box-shadow: ${shadow} !important;
  color: ${text};
  --pg-icon: ${text};
  --mantine-color-dimmed: ${dimmed};
  ${isLight ? '' : 'text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);'}
}
.${PLAYER_GLASS_CLASS} { border-radius: 20px !important; }
.${PLAYER_GLASS_POPOVER_CLASS} { border-radius: 16px !important; }
/* Popover arrow must match the glass, or it shows as a solid grey notch */
.${PLAYER_GLASS_POPOVER_CLASS} .mantine-Popover-arrow { display: none; }
.${PLAYER_GLASS_CLASS} .mantine-Text-root,
.${PLAYER_GLASS_POPOVER_CLASS} .mantine-Text-root { text-shadow: inherit; }

/* High-contrast icons. --ai-color is what Mantine's ActionIcon reads for its
   colour; the muted (red) volume icon sets an inline colour and still wins. */
.${PLAYER_GLASS_CLASS} .mantine-ActionIcon-root[data-variant='subtle'],
.${PLAYER_GLASS_POPOVER_CLASS} .mantine-ActionIcon-root[data-variant='subtle'] {
  --ai-color: var(--pg-icon) !important;
}
.${PLAYER_GLASS_CLASS} .mantine-ActionIcon-root svg,
.${PLAYER_GLASS_POPOVER_CLASS} .mantine-ActionIcon-root svg {
  filter: drop-shadow(${iconShadow});
}

/* Effects popover rows (category headers) */
.${PLAYER_GLASS_POPOVER_CLASS} .gam-fx-row {
  border-radius: 10px;
  transition: background 120ms ease;
}
.${PLAYER_GLASS_POPOVER_CLASS} .gam-fx-row:hover { background: ${hover}; }
`;
}

export function PlayerGlassStyles() {
  const isLight = useComputedColorScheme('dark') === 'light';
  return <style>{buildCss(isLight)}</style>;
}