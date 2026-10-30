import { ActionIcon, Tooltip } from '@mantine/core';
import { IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import { GLASS_BUTTON_CLASS, TOOLTIP_PROPS } from './Glasseffect';
import { formatAction } from '../keybinds';

/**
 * Round glass fullscreen button, bottom right corner of the image / icon viewer.
 * PreviewPane renders it and passes its own toggleFullscreen (what the F key runs).
 * The mini player button sits right above it (bottom: 62).
 */
export function PreviewFullscreenButton({
  onClick,
  isFullscreen = false
}: {
  onClick: () => void;
  isFullscreen?: boolean;
}) {
  return (
    <Tooltip
      label={`${isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} (${formatAction('video.fullscreen')})`}
      position="left"
      withinPortal
      {...TOOLTIP_PROPS}
    >
      <ActionIcon
        className={GLASS_BUTTON_CLASS}
        variant="subtle"
        color="gray"
        size={38}
        radius="xl"
        aria-label="Fullscreen"
        onClick={(e) => {
          e.currentTarget.blur();
          onClick();
        }}
        style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 6 }}
      >
        {isFullscreen ? <IconArrowsMinimize size={18} /> : <IconArrowsMaximize size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
