import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { GLASS_CLASS } from './Glasseffect';
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from '../util/smooth-zoom';

// Height the zoom pill + the mini + fullscreen buttons need at full size:
// 44 (top) + 124 (pill) + 8 (gap) + 100 (two round buttons and their gap) = 276.
const STACK_FULL_H = 276;
const STACK_MIN_SCALE = 0.65;

/** Shared by ZoomControl and PreviewPane so the pill and the round buttons shrink together. */
export const stackScale = (h: number): number =>
  h > 0 ? Math.max(STACK_MIN_SCALE, Math.min(1, h / STACK_FULL_H)) : 1;

interface Props {
  /** 1 = fit. Shown as a percentage. */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Clicking the percentage: back to fit (also resets the pan). */
  onReset: () => void;
  /** Optional overrides (px at full size). */
  top?: number;
  right?: number;
}

/**
 * Tall vertical pill: + on top, the percentage in the middle (click = reset to
 * fit), - at the bottom. Used by ImagePreview and IconPreview so the two match.
 * When the preview is short it shrinks smoothly (about its center, so it stays
 * lined up with the round buttons under it).
 */
export function ZoomControl({ zoom, onZoomIn, onZoomOut, onReset, top = 44, right }: Props) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return undefined;
    const update = () => setH(parent.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const s = stackScale(h);
  // The round buttons are 38 px wide with 12 px from the edge, so their center is 31 px from
  // the right. The pill is 38 px wide, so right = 31 - 19 keeps both centers on one line.
  const r = right ?? 31 * s - 19;

  return (
    <div
      ref={ref}
      className={GLASS_CLASS}
      data-zoom-control
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        top: top * s,
        right: r,
        zIndex: 6,
        width: 38,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '5px 0',
        borderRadius: 19,
        cursor: 'default',
        userSelect: 'none',
        transform: `scale(${s})`,
        transformOrigin: 'top center',
        transition: 'transform 0.25s ease, top 0.25s ease, right 0.25s ease'
      }}
    >
      <Tooltip label="Zoom in" position="left" withinPortal>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={32}
          radius="xl"
          onClick={onZoomIn}
          disabled={zoom >= VIEW_ZOOM_MAX}
          aria-label="Zoom in"
        >
          <IconPlus size={17} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label="Reset to fit" position="left" withinPortal>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset zoom to fit"
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            cursor: 'pointer',
            width: 38,
            padding: '20px 0',
            textAlign: 'center'
          }}
        >
          <Text size="10px" fw={700} style={{ fontFamily: 'monospace', lineHeight: 1 }}>
            {Math.round(zoom * 100)}%
          </Text>
        </button>
      </Tooltip>

      <Tooltip label="Zoom out" position="left" withinPortal>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={32}
          radius="xl"
          onClick={onZoomOut}
          disabled={zoom <= VIEW_ZOOM_MIN}
          aria-label="Zoom out"
        >
          <IconMinus size={17} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}