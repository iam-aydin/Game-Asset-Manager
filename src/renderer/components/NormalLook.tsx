import { useComputedColorScheme } from '@mantine/core';

export const GLASS_CLASS = 'gam-glass';
export const GLASS_POPOVER_CLASS = 'gam-glass-pop';
export const GLASS_TOOLTIP_CLASS = 'gam-glass-tip';

export const TOOLTIP_DELAY_MS = 2000;

export const TOOLTIP_PROPS = {
  openDelay: TOOLTIP_DELAY_MS,
  closeDelay: 0,
  withArrow: false,
  classNames: { tooltip: GLASS_TOOLTIP_CLASS }
} as const;

function buildCss(isLight: boolean): string {
  const bg = isLight ? '#ffffff' : '#25262b';
  const border = isLight ? '#dee2e6' : '#373a40';
  const text = isLight ? '#16171a' : '#ececee';
  const icon = isLight ? '#5c5f66' : '#a6a7ab';
  const shadow = isLight ? '0 6px 20px rgba(0,0,0,0.12)' : '0 6px 20px rgba(0,0,0,0.4)';

  return `
.${GLASS_CLASS},
.${GLASS_POPOVER_CLASS},
.${GLASS_TOOLTIP_CLASS} {
  background: ${bg} !important;
  border: 1px solid ${border} !important;
  box-shadow: ${shadow} !important;
  color: ${text} !important;
  --pg-icon: ${icon};
}
.${GLASS_CLASS} { border-radius: 12px !important; }
.${GLASS_POPOVER_CLASS} { border-radius: 10px !important; }
.${GLASS_TOOLTIP_CLASS} {
  padding: 3px 8px !important;
  font-size: 11px !important;
  line-height: 1.3 !important;
  border-radius: 6px !important;
}
.${GLASS_POPOVER_CLASS} .mantine-Modal-header,
.${GLASS_POPOVER_CLASS} .mantine-Modal-body { background: transparent; }
.${GLASS_CLASS} .mantine-ActionIcon-root[data-variant='subtle'],
.${GLASS_POPOVER_CLASS} .mantine-ActionIcon-root[data-variant='subtle'] {
  --ai-color: var(--pg-icon) !important;
}
`;
}

export function GlassStyles() {
  const isLight = useComputedColorScheme('dark') === 'light';
  return <style>{buildCss(isLight)}</style>;
}
