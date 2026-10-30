import { ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { GLASS_CLASS } from './Glasseffect';
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from '../util/smooth-zoom';

interface Props {
  /** 1 = fit. Shown as a percentage. */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Clicking the percentage: back to fit (also resets the pan). */
  onReset: () => void;
  /** Distance from the top of the preview. 44 sits right under the 28px mini-player
   *  button at top: 8. */
  top?: number;
  right?: number;
}

/**
 * Tall vertical pill: + on top, the percentage in the middle (click = reset to
 * fit), - at the bottom. Used by ImagePreview and IconPreview so the two match.
 * Its pointer events never reach the viewer underneath.
 */
export function ZoomControl({ zoom, onZoomIn, onZoomOut, onReset, top = 44, right = 8 }: Props) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
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
        top,
        right,
        zIndex: 6,
        width: 38,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '5px 0',
        borderRadius: 19,
        cursor: 'default',
        userSelect: 'none'
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
