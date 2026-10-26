import { useId } from 'react';

/**
 * Glass folders that adapt to the theme.
 *
 * All colors come from CSS variables (--fg-*) that <FolderGlyphStyles /> defines:
 *   - default (dark themes): soft glass with a blurred red-to-blue glow behind it
 *   - light / pastel themes (data-wh3d-scheme="light"): tinted glass + dark navy rim
 *   - cyberpunk (theme id or name contains "cyber"): yellow-to-red, darker glass,
 *     bright yellow rim and a crisp black outline
 * Edit the CSS block below to tune any theme. No shadows on purpose.
 */
const ACCENT = 'var(--wh3d-folder-accent, var(--mantine-color-indigo-4))';

const CSS = `
:root {
  --fg-c1: color-mix(in srgb, ${ACCENT} 40%, #ff2d55);
  --fg-c2: color-mix(in srgb, ${ACCENT} 40%, #3b5bdb);
  --fg-blob-op: 0.9;
  --fg-under-op: 0;
  --fg-body-op: 0;
  --fg-glass-top: 0.5;
  --fg-glass-bot: 0.16;
  --fg-rim-a: rgba(255, 255, 255, 0.95);
  --fg-rim-b: rgba(255, 255, 255, 0.3);
  --fg-rim-c: rgba(255, 255, 255, 0.7);
  --fg-rim-w: 0.35;
  --fg-rim-w-mini: 0.55;
  --fg-edge: rgba(255, 255, 255, 0.25);
  --fg-outline: transparent;
  --fg-outline-w: 0;
  --fg-outline-w-mini: 0;
}
html[data-wh3d-scheme='light'] {
  --fg-c1: color-mix(in srgb, ${ACCENT} 30%, #e11d5a);
  --fg-c2: color-mix(in srgb, ${ACCENT} 30%, #3156d3);
  --fg-blob-op: 0.5;
  --fg-body-op: 0.6;
  --fg-glass-top: 0.5;
  --fg-glass-bot: 0.08;
  --fg-rim-a: rgba(20, 28, 70, 0.85);
  --fg-rim-b: rgba(20, 28, 70, 0.45);
  --fg-rim-c: rgba(20, 28, 70, 0.7);
  --fg-rim-w: 0.5;
  --fg-rim-w-mini: 0.9;
  --fg-edge: rgba(255, 255, 255, 0.7);
}
html[data-wh3d-theme*='cyber' i],
html[data-wh3d-label*='cyber' i] {
  --fg-c1: #fcee09;
  --fg-c2: #ff2a40;
  --fg-blob-op: 0.8;
  --fg-under-op: 0.6;
  --fg-body-op: 0.5;
  --fg-glass-top: 0.28;
  --fg-glass-bot: 0.06;
  --fg-rim-a: #fcee09;
  --fg-rim-b: #ffb400;
  --fg-rim-c: #ff2a40;
  --fg-rim-w: 0.7;
  --fg-rim-w-mini: 1;
  --fg-edge: rgba(252, 238, 9, 0.4);
  --fg-outline: rgba(0, 0, 0, 0.9);
  --fg-outline-w: 1.1;
  --fg-outline-w-mini: 1.7;
}
`;

/** Render once (App.tsx does this). */
export function FolderGlyphStyles() {
  return <style>{CSS}</style>;
}

/** Closed folder (16 x 16, the GitHub folder shape). */
const CLOSED =
  'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z';
/** Front flap of the open folder. */
const OPEN_FRONT =
  'M3 6.2H15.4Q16.2 6.2 16 7L14.4 14.2Q14.2 15 13.4 15H1.2Q0.4 15 0.6 14.2L2.2 7Q2.4 6.2 3 6.2Z';

function useUid() {
  return useId().replace(/[^a-zA-Z0-9]/g, '');
}

function Defs({ id, blur }: { id: string; blur: number }) {
  return (
    <defs>
      <linearGradient id={`${id}rb`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style={{ stopColor: 'var(--fg-c1)' }} />
        <stop offset="1" style={{ stopColor: 'var(--fg-c2)' }} />
      </linearGradient>
      <linearGradient id={`${id}glass`} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#ffffff" style={{ stopOpacity: 'var(--fg-glass-top)' }} />
        <stop offset="1" stopColor="#ffffff" style={{ stopOpacity: 'var(--fg-glass-bot)' }} />
      </linearGradient>
      <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--fg-rim-a)' }} />
        <stop offset="0.5" style={{ stopColor: 'var(--fg-rim-b)' }} />
        <stop offset="1" style={{ stopColor: 'var(--fg-rim-c)' }} />
      </linearGradient>
      <filter id={`${id}blur`} filterUnits="userSpaceOnUse" x="-6" y="-6" width="28" height="28">
        <feGaussianBlur stdDeviation={blur} />
      </filter>
      <filter id={`${id}soft`} filterUnits="userSpaceOnUse" x="-6" y="-6" width="28" height="28">
        <feGaussianBlur stdDeviation="0.45" />
      </filter>
      <clipPath id={`${id}clip`}>
        <path d={CLOSED} />
      </clipPath>
    </defs>
  );
}

/** Large folder used on the tiles in the grid. */
export function GlassFolderBig({ hasFiles = true }: { hasFiles?: boolean }) {
  const id = useUid();
  return (
    <svg
      viewBox="-3.5 -3.5 23 23"
      aria-hidden="true"
      style={{ width: '100%', height: 'auto', display: 'block', opacity: hasFiles ? 1 : 0.6 }}
    >
      <Defs id={id} blur={1.2} />
      {/* blurred gradient glow behind the folder */}
      <ellipse
        cx="8"
        cy="9"
        rx="7.4"
        ry="5.6"
        fill={`url(#${id}rb)`}
        style={{ opacity: 'var(--fg-blob-op)' }}
        filter={`url(#${id}blur)`}
      />
      {/* dark glass underlay (cyberpunk) and gradient tint inside the glass */}
      <path d={CLOSED} fill="#000000" style={{ fillOpacity: 'var(--fg-under-op)' }} />
      <path d={CLOSED} fill={`url(#${id}rb)`} style={{ fillOpacity: 'var(--fg-body-op)' }} />
      {/* frosted glass */}
      <path d={CLOSED} fill="#ffffff" fillOpacity="0.12" filter={`url(#${id}soft)`} />
      <path d={CLOSED} fill={`url(#${id}glass)`} />
      <g clipPath={`url(#${id}clip)`}>
        <path d={CLOSED} fill="none" strokeWidth="1.6" style={{ stroke: 'var(--fg-edge)' }} />
      </g>
      {/* crisp outline + rim */}
      <path
        d={CLOSED}
        fill="none"
        style={{ stroke: 'var(--fg-outline)', strokeWidth: 'var(--fg-outline-w)' }}
      />
      <path
        d={CLOSED}
        fill="none"
        stroke={`url(#${id}rim)`}
        style={{ strokeWidth: 'var(--fg-rim-w)' }}
      />
    </svg>
  );
}

/** Small folder used in the left tree and the list view. */
export function GlassFolderMini({
  open = false,
  hasFiles = true
}: {
  open?: boolean;
  hasFiles?: boolean;
}) {
  const id = useUid();
  return (
    <svg
      width="22"
      height="22"
      viewBox="-3 -3 22 22"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: hasFiles ? 1 : 0.6 }}
    >
      <Defs id={id} blur={1} />
      <ellipse
        cx="8"
        cy="9"
        rx="7"
        ry="5.2"
        fill={`url(#${id}rb)`}
        style={{ opacity: 'var(--fg-blob-op)' }}
        filter={`url(#${id}blur)`}
      />
      {open ? (
        <>
          <path d={CLOSED} fill={`url(#${id}rb)`} style={{ fillOpacity: 'var(--fg-body-op)' }} />
          <path d={CLOSED} fill={`url(#${id}glass)`} fillOpacity="0.6" />
          <path d={OPEN_FRONT} fill="#000000" style={{ fillOpacity: 'var(--fg-under-op)' }} />
          <path d={OPEN_FRONT} fill={`url(#${id}rb)`} style={{ fillOpacity: 'var(--fg-body-op)' }} />
          <path d={OPEN_FRONT} fill={`url(#${id}glass)`} />
          <path
            d={OPEN_FRONT}
            fill="none"
            style={{ stroke: 'var(--fg-outline)', strokeWidth: 'var(--fg-outline-w-mini)' }}
          />
          <path
            d={OPEN_FRONT}
            fill="none"
            stroke={`url(#${id}rim)`}
            style={{ strokeWidth: 'var(--fg-rim-w-mini)' }}
          />
        </>
      ) : (
        <>
          <path d={CLOSED} fill="#000000" style={{ fillOpacity: 'var(--fg-under-op)' }} />
          <path d={CLOSED} fill={`url(#${id}rb)`} style={{ fillOpacity: 'var(--fg-body-op)' }} />
          <path d={CLOSED} fill={`url(#${id}glass)`} />
          <path
            d={CLOSED}
            fill="none"
            style={{ stroke: 'var(--fg-outline)', strokeWidth: 'var(--fg-outline-w-mini)' }}
          />
          <path
            d={CLOSED}
            fill="none"
            stroke={`url(#${id}rim)`}
            style={{ strokeWidth: 'var(--fg-rim-w-mini)' }}
          />
        </>
      )}
    </svg>
  );
}