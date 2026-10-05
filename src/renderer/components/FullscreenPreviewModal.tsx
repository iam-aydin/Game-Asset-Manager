import { useState, useEffect, type ReactNode } from 'react';
import {
  Modal,
  Stack,
  Text,
  Center,
  Box,
  Group,
  ActionIcon,
  Button,
  SegmentedControl
} from '@mantine/core';
import type { FileRecord } from '@shared/types';
import type { LightingStyle } from '@shared/lighting-types';
import { DEFAULT_HDRI, type HdriId } from '@shared/hdri';
import { isAudioExtension, isImageExtension } from '@shared/formats';
import { ModelViewer } from '../three/ModelViewer';
import { LIGHTING_PRESETS } from '../three/lighting-presets';
import { HDRI_PRESETS, getHdriPreset } from '../three/hdri-presets';
import { TextPreview } from './TextPreview';
import { AudioPlayer } from './AudioPlayer';
import { usePreferences, savePreferences } from '../util/use-preferences';
import { DEFAULT_RENDER_QUALITY } from '@shared/render-quality';

interface Props {
  opened: boolean;
  onClose: () => void;
  libraryId: string | null;
  file: FileRecord | null;
  lightingStyle: LightingStyle;
  /**
   * Optional. When given, a view-mode change made in fullscreen is also
   * reported to the parent so the preview pane stays in sync. When omitted,
   * the modal keeps its own copy of the mode while it is open.
   */
  onLightingStyleChange?: (style: LightingStyle) => void;
}

const isTextExtension = (ext: string): boolean =>
  ['md', 'txt', 'json', 'log', 'yaml', 'yml', 'ini', 'cfg', 'markdown'].includes(
    ext.replace(/^\./, '').toLowerCase()
  );

const PAN_STEP = 40;
const ZOOM_STEP = 0.15;

/**
 * Interactive Image Pan/Zoom Viewer with Keyboard & Mouse Shortcuts
 */
function ImageViewer({ src, alt, thumbUrl }: { src: string; alt: string; thumbUrl: string }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgSrc, setImgSrc] = useState(src);

  useEffect(() => {
    setImgSrc(src);
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [src]);

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Keyboard Navigation: W/S (Zoom), A/D (Pan Left/Right), Shift+W/S (Pan Up/Down), R (Reset)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 'r') {
        e.preventDefault();
        handleReset();
      } else if (key === 'a') {
        e.preventDefault();
        setPosition((prev) => ({ ...prev, x: prev.x + PAN_STEP }));
      } else if (key === 'd') {
        e.preventDefault();
        setPosition((prev) => ({ ...prev, x: prev.x - PAN_STEP }));
      } else if (key === 'w') {
        e.preventDefault();
        if (e.shiftKey) {
          setPosition((prev) => ({ ...prev, y: prev.y + PAN_STEP }));
        } else {
          setScale((s) => Math.min(10, s + ZOOM_STEP));
        }
      } else if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          setPosition((prev) => ({ ...prev, y: prev.y - PAN_STEP }));
        } else {
          setScale((s) => Math.max(0.5, s - ZOOM_STEP));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    const newScale = Math.min(Math.max(0.5, scale + delta), 10);
    setScale(newScale);
    if (newScale === 1) {
      setPosition({ x: 0, y: 0 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle Mouse Button (button 1) resets zoom/pan
    if (e.button === 1) {
      e.preventDefault();
      handleReset();
      return;
    }

    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <Box
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none'
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleReset}
    >
      <Center h="100%" w="100%">
        <img
          src={imgSrc}
          alt={alt}
          onError={() => {
            if (imgSrc !== thumbUrl) setImgSrc(thumbUrl);
          }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.08s ease-out',
            pointerEvents: 'none'
          }}
        />
      </Center>

      {/* Zoom / Reset Controls */}
        <Group
          gap={6}
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
            padding: '4px 8px',
            borderRadius: 8,
            border: '1px solid var(--wh3d-overlay-border, #2C2E33)',
            backdropFilter: 'blur(4px)',
            zIndex: 10
          }}
>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => setScale((s) => Math.max(0.5, s - ZOOM_STEP))}
        >
          −
        </ActionIcon>
        <Text size="xs" c="dimmed" style={{ minWidth: 40, textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => setScale((s) => Math.min(10, s + ZOOM_STEP))}
        >
          +
        </ActionIcon>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          onClick={handleReset}
          style={{ fontSize: 11, padding: '0 6px', height: 22 }}
        >
          Reset (R)
        </Button>
      </Group>
    </Box>
  );
}

function ControlBlock({
  label,
  hint,
  children
}: {
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Group gap={6} wrap="nowrap">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          {label}
        </Text>
        {hint != null && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </Group>
      {children}
    </Stack>
  );
}

/**
 * Spacebar-launched fullscreen viewer with balanced header margins.
 */
export function FullscreenPreviewModal({
  opened,
  onClose,
  libraryId,
  file,
  lightingStyle,
  onLightingStyleChange
}: Props) {
  const { prefs } = usePreferences();
  const renderQuality = prefs?.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const hdri: HdriId = prefs?.hdri ?? DEFAULT_HDRI;
  const showGrid = prefs?.showGrid ?? false;

  // Local copy of the view mode so the picker works even when the parent
  // doesn't pass `onLightingStyleChange`. Re-syncs from the parent whenever
  // the modal opens or the parent's value changes.
  const [viewMode, setViewMode] = useState<LightingStyle>(lightingStyle);
  useEffect(() => {
    setViewMode(lightingStyle);
  }, [lightingStyle, opened]);

  const handleViewModeChange = (next: LightingStyle) => {
    setViewMode(next);
    onLightingStyleChange?.(next);
  };

  // HDRI and grid are global preferences, shared with the preview pane.
  // Wait for the prefs to load so we never overwrite the file with an empty one.
  const handleHdriChange = (next: HdriId) => {
    if (!prefs) return;
    void savePreferences({ ...prefs, hdri: next });
  };
  const handleGridChange = (on: boolean) => {
    if (!prefs) return;
    void savePreferences({ ...prefs, showGrid: on });
  };

const modalStyles = {
  header: {
    padding: '12px 18px',
    background: 'var(--mantine-color-dark-8)',
    borderBottom: '1px solid var(--mantine-color-dark-4)'
  },
  title: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--mantine-color-text-primary)'
  },
  close: {
    color: 'var(--mantine-color-text-dimmed)'
  },
  body: {
    height: 'calc(100vh - 53px)',
    padding: 0,
    overflow: 'hidden'
  },
  content: {
    background: 'var(--mantine-color-dark-8)',
    overflow: 'hidden'
  },
  inner: {
    padding: 0
  }
};

  if (!file || !libraryId) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        fullScreen
        withCloseButton
        title="Preview"
        styles={modalStyles}
      >
        <Stack align="center" justify="center" h="100%">
          <Text c="dimmed">Select a file to preview.</Text>
        </Stack>
      </Modal>
    );
  }

  const isText = isTextExtension(file.ext);
  const isAudio = isAudioExtension(file.ext);
  const isImage = isImageExtension(file.ext);
  const isModel = !isText && !isAudio && !isImage;

  const encodedLibId = encodeURIComponent(libraryId);
  const fileUrl = `wh3d-file://${encodedLibId}/${file.id}?t=${file.mtimeMs}`;
  const thumbUrl = `wh3d-thumb://${encodedLibId}/${file.id}?t=${file.mtimeMs}`;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton
      title={file.filename}
      styles={modalStyles}
    >
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          {isText ? (
            <TextPreview libraryId={libraryId} file={file} />
          ) : isAudio ? (
            <Center h="100%" p="xl">
              <Box style={{ width: '100%', maxWidth: 680 }}>
                <AudioPlayer
                  libraryId={libraryId}
                  fileId={file.id}
                  filename={file.filename}
                  thumbSrc={file.hasThumb ? thumbUrl : null}
                />
              </Box>
            </Center>
          ) : isImage ? (
            <ImageViewer src={fileUrl} alt={file.filename} thumbUrl={thumbUrl} />
          ) : (
            <ModelViewer
              libraryId={libraryId}
              file={file}
              lightingStyle={viewMode}
              hdri={hdri}
              showGrid={showGrid}
              renderQuality={renderQuality}
            />
          )}
        </div>

        {/* Same view / environment / grid controls as the preview pane */}
        {isModel && (
          <div
            style={{
              flexShrink: 0,
              padding: '8px 12px',
              borderTop: '1px solid var(--mantine-color-dark-4)',
              background: 'var(--mantine-color-dark-7)'
            }}
          >
            <Group gap="md" wrap="nowrap">
              <ControlBlock
                label="View"
                hint={LIGHTING_PRESETS.find((p) => p.id === viewMode)?.label}
              >
                <SegmentedControl
                  size="xs"
                  value={viewMode}
                  onChange={(v) => handleViewModeChange(v as LightingStyle)}
                  data={LIGHTING_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                />
              </ControlBlock>

              <ControlBlock label="Environment" hint={getHdriPreset(hdri).label}>
                <SegmentedControl
                  size="xs"
                  value={hdri}
                  onChange={(v) => handleHdriChange(v as HdriId)}
                  data={HDRI_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                />
              </ControlBlock>

              <ControlBlock label="Grid" hint={showGrid ? 'On' : 'Off'}>
                <SegmentedControl
                  size="xs"
                  value={showGrid ? 'on' : 'off'}
                  onChange={(v) => handleGridChange(v === 'on')}
                  data={[
                    { value: 'off', label: 'Off' },
                    { value: 'on', label: 'On' }
                  ]}
                />
              </ControlBlock>
            </Group>
          </div>
        )}
      </div>
    </Modal>
  );
}