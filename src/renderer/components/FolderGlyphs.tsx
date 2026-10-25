import { useId } from 'react';

/**
 * Full-glass folders (like the phone folders): see-through, frosted, with a white
 * rim and a soft shine. Only a faint red-to-blue tint sits underneath, mixed with
 * the theme color (--wh3d-folder-accent, falling back to the theme's indigo).
 * No shadows or glows on purpose.
 *
 * Tweak here:
 *   TINT_BACK / TINT_FRONT : how visible the red-to-blue color is (0 to 1)
 *   MIX                    : how much theme color is kept in the tint
 */
const ACCENT = 'var(--wh3d-folder-accent, var(--mantine-color-indigo-4))';
const RED = '#ff2d55';
const BLUE = '#3b5bdb';
const MIX = 62;
const TINT_BACK = 0.34;
const TINT_FRONT = 0.2;

const LEFT = `color-mix(in srgb, ${ACCENT} ${MIX}%, ${RED})`;
const RIGHT = `color-mix(in srgb, ${ACCENT} ${MIX}%, ${BLUE})`;

function useUid() {
  return useId().replace(/[^a-zA-Z0-9]/g, '');
}

const BACK_PATH =
  'M12 22 Q12 10 24 10 H76 Q84 10 90 17 L96 24 H176 Q188 24 188 36 V136 Q188 146 176 146 H24 Q12 146 12 136 Z';
const FRONT_PATH =
  'M8 52 Q8 40 20 40 H180 Q192 40 192 52 V138 Q192 150 180 150 H20 Q8 150 8 138 Z';
const FRONT_INNER_PATH =
  'M11 53 Q11 43 21 43 H179 Q189 43 189 53 V137 Q189 147 179 147 H21 Q11 147 11 137 Z';

/** Large folder used on the tiles in the grid. */
export function GlassFolderBig() {
  const id = useUid();
  return (
    <svg viewBox="0 0 200 160" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: LEFT }} />
          <stop offset="1" style={{ stopColor: RIGHT }} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* back panel with the tab, seen through the front glass */}
      <path d={BACK_PATH} fill={`url(#${id}t)`} fillOpacity={TINT_BACK} />
      <path d={BACK_PATH} fill="#ffffff" fillOpacity="0.07" />
      <path
        d={BACK_PATH}
        fill="none"
        stroke="rgba(255, 255, 255, 0.42)"
        strokeWidth="1.2"
      />

      {/* front glass panel */}
      <path d={FRONT_PATH} fill={`url(#${id}t)`} fillOpacity={TINT_FRONT} />
      <path d={FRONT_PATH} fill="#ffffff" fillOpacity="0.07" />
      <path d={FRONT_PATH} fill={`url(#${id}s)`} />
      {/* diagonal shine */}
      <path
        d="M8 52 Q8 40 20 40 H116 L64 150 H20 Q8 150 8 138 Z"
        fill="#ffffff"
        fillOpacity="0.07"
      />
      {/* rim light and inner glass edge */}
      <path d={FRONT_PATH} fill="none" stroke={`url(#${id}e)`} strokeWidth="1.8" />
      <path d={FRONT_INNER_PATH} fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="1" />
      <path d="M22 44.5 H178" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="1.1" fill="none" />

      {/* faint etched game-controller emblem */}
      <g fill="rgba(255, 255, 255, 0.14)" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1">
        <rect x="68" y="86" width="64" height="36" rx="3" />
        <rect x="108" y="76" width="4" height="10" />
        <rect x="108" y="72" width="12" height="4" />
        <rect x="116" y="64" width="4" height="8" />
      </g>
      <g fill="rgba(255, 255, 255, 0.6)">
        <rect x="77" y="102" width="18" height="4" />
        <rect x="84" y="95" width="4" height="18" />
        <rect x="106" y="102" width="5" height="5" />
        <rect x="117" y="102" width="5" height="5" />
      </g>
    </svg>
  );
}

/** Small folder used in the left tree and the list-view folder strip. */
export function GlassFolderMini({ open = false }: { open?: boolean }) {
  const id = useUid();
  const back =
    'M1 3 Q1 1.5 2.5 1.5 H7 Q8 1.5 8.6 2.3 L9.4 3.3 H17.5 Q19 3.3 19 4.8 V13 Q19 14.5 17.5 14.5 H2.5 Q1 14.5 1 13 Z';
  const front =
    'M1.5 6.2 Q1.5 5 2.7 5 H17.3 Q18.5 5 18.5 6.2 V13 Q18.5 14.5 17 14.5 H3 Q1.5 14.5 1.5 13 Z';
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: LEFT }} />
          <stop offset="1" style={{ stopColor: RIGHT }} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <path d={back} fill={`url(#${id}t)`} fillOpacity={0.4} />
      <path d={back} fill="none" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="0.7" />
      <path d={front} fill={`url(#${id}t)`} fillOpacity={open ? 0.4 : 0.26} />
      <path d={front} fill={`url(#${id}s)`} />
      <path d={front} fill="none" stroke="rgba(255, 255, 255, 0.65)" strokeWidth="0.8" />
    </svg>
  );
}