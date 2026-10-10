import { useComputedColorScheme } from '@mantine/core';

export const GLASS_CLASS = 'gam-glass';
export const GLASS_POPOVER_CLASS = 'gam-glass-pop';
export const GLASS_TOOLTIP_CLASS = 'gam-glass-tip';

/** Hover time before a tooltip appears. */
export const TOOLTIP_DELAY_MS = 2000;

/** Spread these onto any Mantine <Tooltip> (or use them in the theme). */
export const TOOLTIP_PROPS = {
  openDelay: TOOLTIP_DELAY_MS,
  closeDelay: 0,
  withArrow: false,
  classNames: { tooltip: GLASS_TOOLTIP_CLASS }
} as const;

function buildCss(isLight: boolean): string {
  const tint = 'linear-gradient(135deg, rgba(59, 91, 219, 0.1), rgba(255, 0, 0, 0.1))';
  const bg = isLight ? `${tint}, rgba(255, 255, 255, 0.62)` : tint;
  const border = isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.22)';
  const text = isLight ? '#16171a' : '#ececee';
  const icon = isLight ? '#5c5f66' : '#a6a7ab';
  const dimmed = isLight ? '#4a4d57' : '#b4b6bd';
  const hover = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)';
  const iconShadow = isLight
    ? '0 1px 1.5px rgba(0, 0, 0, 0.35)'
    : '0 1px 2px rgba(0, 0, 0, 0.6)';
  const textGlow = isLight ? 'inherit' : '0px 1px 20px #000000';
  const blur = isLight ? 'blur(18px) saturate(140%)' : 'blur(14px) saturate(130%)';
  const shadow = isLight
    ? '0 0 0 1px rgba(30,40,70,0.1), 0 12px 36px rgba(30,40,70,0.18), inset 0 1px 0 rgba(255,255,255,0.9)'
    : '0 12px 36px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25)';
  const tipShadow = isLight
    ? '0 0 0 1px rgba(30,40,70,0.08), 0 4px 14px rgba(30,40,70,0.16), inset 0 1px 0 rgba(255,255,255,0.9)'
    : '0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.22)';

  return `
.${GLASS_CLASS},
.${GLASS_POPOVER_CLASS},
.${GLASS_TOOLTIP_CLASS} {
  background: ${bg} !important;
  -webkit-backdrop-filter: ${blur};
  backdrop-filter: ${blur};
  border: 1px solid ${border} !important;
  box-shadow: ${shadow} !important;
  color: ${text} !important;
  --pg-icon: ${icon};
  --mantine-color-dimmed: ${dimmed};
  ${isLight ? '' : 'text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);'}
}
.${GLASS_CLASS} { border-radius: 20px !important; }
.${GLASS_POPOVER_CLASS} { border-radius: 16px !important; }

/* Small tooltip: tighter, lighter shadow */
.${GLASS_TOOLTIP_CLASS} {
  padding: 3px 8px !important;
  font-size: 11px !important;
  line-height: 1.3 !important;
  font-weight: 500;
  border-radius: 8px !important;
  box-shadow: ${tipShadow} !important;
}

.${GLASS_POPOVER_CLASS} .mantine-Popover-arrow { display: none; }
.${GLASS_POPOVER_CLASS} .mantine-Modal-header,
.${GLASS_POPOVER_CLASS} .mantine-Modal-body { background: transparent; }
.${GLASS_POPOVER_CLASS} .mantine-Modal-title { font-weight: 600; }
.${GLASS_POPOVER_CLASS} .mantine-Modal-close { color: var(--pg-icon); }
.${GLASS_CLASS} .mantine-Text-root,
.${GLASS_POPOVER_CLASS} .mantine-Text-root { text-shadow: ${textGlow}; }

.${GLASS_CLASS} .mantine-ActionIcon-root[data-variant='subtle'],
.${GLASS_POPOVER_CLASS} .mantine-ActionIcon-root[data-variant='subtle'] {
  --ai-color: var(--pg-icon) !important;
}
.${GLASS_CLASS} .mantine-ActionIcon-root svg,
.${GLASS_POPOVER_CLASS} .mantine-ActionIcon-root svg {
  filter: drop-shadow(${iconShadow});
}

.${GLASS_POPOVER_CLASS} .gam-fx-row {
  border-radius: 10px;
  transition: background 120ms ease;
}
.${GLASS_POPOVER_CLASS} .gam-fx-row:hover { background: ${hover}; }
`;
}

/** Render once, inside MantineProvider (e.g. in App.tsx). */
export function GlassStyles() {
  const isLight = useComputedColorScheme('dark') === 'light';
  return <style>{buildCss(isLight)}</style>;
}
