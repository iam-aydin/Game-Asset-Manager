import type { ReactNode, SVGProps } from 'react';

// Thin Fluent / PotPlayer-style icons for the player bars (1.6 stroke, currentColor).
type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SubtitlesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 13.5h10M7 16.5h6" />
  </Svg>
);

export const ExpandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 4H20v5.5M20 4l-6.5 6.5M9.5 20H4v-5.5M4 20l6.5-6.5" />
  </Svg>
);

export const ShrinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 10h-5.5V4.5M14.5 9.5L20 4M4 14h5.5v5.5M9.5 14.5L4 20" />
  </Svg>
);

export const MiniIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5" />
    <rect x="13" y="13" width="8" height="6" rx="1.2" />
    <path d="M8 8l4 4M12 8.5V12H8.5" />
  </Svg>
);

export const MiniOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5" />
    <rect x="13" y="13" width="8" height="6" rx="1.2" />
    <path d="M12 12L8 8M8 11.5V8h3.5" />
  </Svg>
);

export const SpeakerIcon = ({
  level,
  ...p
}: IconProps & { level: 'off' | 'low' | 'high' }) => (
  <Svg {...p}>
    <path d="M11 5L6.5 9H3.5v6h3L11 19V5z" />
    {level === 'off' && <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />}
    {level === 'low' && <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />}
    {level === 'high' && <path d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.5a8 8 0 0 1 0 11" />}
  </Svg>
);
