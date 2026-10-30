import { useComputedColorScheme } from '@mantine/core';

export const GLASS_CLASS = 'gam-glass';
export const GLASS_POPOVER_CLASS = 'gam-glass-pop';
export const GLASS_TOOLTIP_CLASS = 'gam-glass-tip';

/** Small glass icon buttons that float over a preview (expand, mini player,
 *  the mini player header buttons). Put it on a Mantine <ActionIcon>. Add
 *  data-glass-active="true" for the tinted "on" state. The border color comes
 *  from --wh3d-overlay-border, the same variable the zoom controls use, so it
 *  follows every theme. */
export const GLASS_BUTTON_CLASS = 'gam-glass-btn';

/** The ring around the capture (camera) button in the preview controls.
 *  Needs data-active / data-sticky attributes. The camera button inside it
 *  gets GLASS_RING_BUTTON_CLASS. */
export const GLASS_RING_CLASS = 'gam-camera-ring';
export const GLASS_RING_BUTTON_CLASS = 'gam-camera-btn';

/** Wide pill action buttons inside menus (Save as file, Shrink, Fit ...). Glass like
 *  everything else, tinted from dark blue (left) to dark red (right). Put it on an
 *  UnstyledButton; data-tone="soft" makes it quieter. */
export const GLASS_ACTION_CLASS = 'gam-glass-action';

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
  // Menu / dropdown rows: readable over any background behind the glass.
  const itemShadow = isLight
    ? '0 0 6px rgba(255, 255, 255, 0.9), 0 0 2px rgba(255, 255, 255, 0.8)'
    : '0 1px 3px rgba(0, 0, 0, 0.8), 0 0 10px rgba(0, 0, 0, 0.6)';
  const blur = isLight ? 'blur(18px) saturate(140%)' : 'blur(14px) saturate(130%)';
  const shadow = isLight
    ? '0 0 0 1px rgba(30,40,70,0.1), 0 12px 36px rgba(30,40,70,0.18), inset 0 1px 0 rgba(255,255,255,0.9)'
    : '0 12px 36px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25)';
  const tipShadow = isLight
    ? '0 0 0 1px rgba(30,40,70,0.08), 0 4px 14px rgba(30,40,70,0.16), inset 0 1px 0 rgba(255,255,255,0.9)'
    : '0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.22)';

  // Used by the icon buttons and the camera ring below.
  const overlayBorder = `var(--wh3d-overlay-border, ${border})`;
  const hoverLayer = `linear-gradient(${hover}, ${hover})`;
  const accent = 'var(--mantine-color-indigo-light-color)';

  // Floating icon buttons: no box shadow. In light mode the glass is clear (no
  // white fill) and the icon is white with a dark shadow so it stays readable
  // even over a white background.
  const btnBg = isLight
    ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.03))'
    : bg;
  const btnIcon = isLight ? '#ffffff' : icon;
  const btnIconShadow = isLight
    ? 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))'
    : 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.85)) drop-shadow(0 0 6px rgba(0, 0, 0, 0.5))';
  const btnHover = isLight ? 'rgba(255, 255, 255, 0.2)' : hover;
  const btnHoverLayer = `linear-gradient(${btnHover}, ${btnHover})`;

  // Action buttons: darker and more solid on light backgrounds so the white text stays readable.
  const actBg = isLight
    ? 'linear-gradient(100deg, rgba(28, 46, 140, 0.88), rgba(128, 18, 34, 0.88))'
    : 'linear-gradient(100deg, rgba(22, 38, 110, 0.5), rgba(104, 14, 26, 0.5))';
  const actBgSoft = isLight
    ? 'linear-gradient(100deg, rgba(28, 46, 140, 0.74), rgba(128, 18, 34, 0.74))'
    : 'linear-gradient(100deg, rgba(22, 38, 110, 0.3), rgba(104, 14, 26, 0.3))';
  const actHover = isLight
    ? 'linear-gradient(100deg, rgba(36, 58, 160, 0.96), rgba(150, 22, 40, 0.96))'
    : 'linear-gradient(100deg, rgba(30, 50, 135, 0.62), rgba(128, 18, 32, 0.62))';
  const actHoverSoft = isLight
    ? 'linear-gradient(100deg, rgba(36, 58, 160, 0.86), rgba(150, 22, 40, 0.86))'
    : 'linear-gradient(100deg, rgba(30, 50, 135, 0.42), rgba(128, 18, 32, 0.42))';
  const actText = isLight ? '#ffffff' : 'inherit';
  const actBorder = isLight ? 'rgba(20, 24, 60, 0.35)' : 'rgba(255, 255, 255, 0.16)';

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

.${GLASS_CLASS} .mantine-Menu-item,
.${GLASS_CLASS} .mantine-Menu-itemLabel,
.${GLASS_CLASS} .mantine-Menu-label,
.${GLASS_CLASS} .mantine-Select-option,
.${GLASS_CLASS} .mantine-Combobox-option,
.${GLASS_CLASS} [role='menuitem'],
.${GLASS_CLASS} [role='option'],
.${GLASS_POPOVER_CLASS} .mantine-Menu-item,
.${GLASS_POPOVER_CLASS} .mantine-Menu-itemLabel,
.${GLASS_POPOVER_CLASS} .mantine-Menu-label,
.${GLASS_POPOVER_CLASS} .mantine-Select-option,
.${GLASS_POPOVER_CLASS} .mantine-Combobox-option,
.${GLASS_POPOVER_CLASS} [role='menuitem'],
.${GLASS_POPOVER_CLASS} [role='option'] {
  text-shadow: ${itemShadow};
}

.${GLASS_POPOVER_CLASS} .gam-fx-row {
  border-radius: 10px;
  transition: background 120ms ease;
}
.${GLASS_POPOVER_CLASS} .gam-fx-row:hover { background: ${hover}; }

/* ── Glass icon buttons floating over previews ───────────────────────────
   Same background, blur and highlight as the glass above; the border uses the
   theme's overlay border so it matches the zoom controls. */
.${GLASS_BUTTON_CLASS}.${GLASS_BUTTON_CLASS} {
  background: ${btnBg} !important;
  -webkit-backdrop-filter: ${blur};
  backdrop-filter: ${blur};
  border: 1px solid ${overlayBorder} !important;
  box-shadow: none !important;
  --ai-color: ${btnIcon} !important;
  transition: background 120ms ease, transform 120ms ease;
}
.${GLASS_BUTTON_CLASS}.${GLASS_BUTTON_CLASS}:hover {
  background: ${btnHoverLayer}, ${btnBg} !important;
  transform: scale(1.05);
}
.${GLASS_BUTTON_CLASS}.${GLASS_BUTTON_CLASS}:active { transform: scale(0.96); }
.${GLASS_BUTTON_CLASS} svg { filter: ${btnIconShadow}; }
.${GLASS_BUTTON_CLASS}.${GLASS_BUTTON_CLASS}[data-glass-active='true'] {
  background:
    linear-gradient(
      color-mix(in srgb, ${accent} 28%, transparent),
      color-mix(in srgb, ${accent} 12%, transparent)
    ),
    ${btnBg} !important;
  --ai-color: ${isLight ? btnIcon : accent} !important;
}

/* ── Ring around the capture (camera) button ─────────────────────────────
   Clicking the ring toggles the thumbnail frame; the camera inside captures.
   The ring reacts only when the pointer is on the ring itself, not while it is
   over the camera. Glow and border colors follow the camera's theme color. */
.${GLASS_RING_CLASS} {
  background: ${bg};
  -webkit-backdrop-filter: ${blur};
  backdrop-filter: ${blur};
  border: 2px solid color-mix(in srgb, ${accent} 35%, transparent);
  box-shadow: ${tipShadow}, 0 0 10px 0 transparent;
  transition: border-color 120ms ease, box-shadow 160ms ease;
}
.${GLASS_RING_CLASS}:hover:not(:has(.${GLASS_RING_BUTTON_CLASS}:hover)) {
  border-color: color-mix(in srgb, ${accent} 75%, transparent);
  box-shadow: ${tipShadow}, 0 0 10px 0 color-mix(in srgb, ${accent} 58%, transparent);
}
/* Sticky (double-clicked): a small dot shows the frame stays on across files. */
.${GLASS_RING_CLASS}[data-sticky='true']::after {
  content: '';
  position: absolute;
  top: -3px;
  right: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${accent};
  box-shadow: 0 0 6px 0 ${accent};
}
/* Frame on: solid border and a soft constant glow. */
.${GLASS_RING_CLASS}[data-active='true'] {
  border-color: ${accent};
  box-shadow: ${tipShadow}, 0 0 8px 0 color-mix(in srgb, ${accent} 40%, transparent);
}
.${GLASS_RING_CLASS}[data-active='true']:hover:not(:has(.${GLASS_RING_BUTTON_CLASS}:hover)) {
  border-color: ${accent};
  box-shadow: ${tipShadow}, 0 0 10px 0 color-mix(in srgb, ${accent} 58%, transparent);
}
/* Camera hover: clearly brighter than idle so it reads as the click target. */
.${GLASS_RING_CLASS} .${GLASS_RING_BUTTON_CLASS} {
  transition: background-color 120ms ease, box-shadow 160ms ease,
    transform 120ms ease, filter 120ms ease;
}
.${GLASS_RING_CLASS} .${GLASS_RING_BUTTON_CLASS}:hover {
  background-color: color-mix(in srgb, ${accent} 38%, transparent) !important;
  box-shadow: 0 0 8px 0 color-mix(in srgb, ${accent} 55%, transparent);
  filter: brightness(1.3);
  transform: scale(1.06);
}
.${GLASS_RING_CLASS} .${GLASS_RING_BUTTON_CLASS}:active { transform: scale(0.96); }

/* ── Action buttons in menus ─────────────────────────────────────────────
   Flat pill: no sheen, no inner highlight, no drop shadow. A dark blue (left) to
   dark red (right) tint over blurred glass, with a thin soft border. */
.${GLASS_ACTION_CLASS} {
  width: 100%;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  color: ${actText};
  background: ${actBg};
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid ${actBorder};
  box-shadow: none;
  transition: background 140ms ease, border-color 140ms ease;
}
.${GLASS_ACTION_CLASS}[data-tone='soft'] {
  background: ${actBgSoft};
}
.${GLASS_ACTION_CLASS}:hover {
  background: ${actHover};
}
.${GLASS_ACTION_CLASS}[data-tone='soft']:hover {
  background: ${actHoverSoft};
}
`;
}

/** Render once, inside MantineProvider (e.g. in App.tsx). */
export function GlassStyles() {
  const isLight = useComputedColorScheme('dark') === 'light';
  return <style>{buildCss(isLight)}</style>;
}