import iconUrl from '../../../build/icon.svg';

interface Props {
  size?: number;
}

/**
 * App icon, used in the header and anywhere else a small square meshFlask
 * mark is needed. Sourced from the same 1024x1024 icon.png used for the
 * packaged app/installer icon — kept as one image so the header logo and
 * the taskbar/dock icon always match. The browser downsamples it for the
 * small header size; no separate small-size asset needed.
 */
export function Logo({ size = 24 }: Props) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt="meshFlask"
      style={{ display: 'block', flexShrink: 0, borderRadius: size * 0.22, objectFit: 'contain' }}
    />
  );
}