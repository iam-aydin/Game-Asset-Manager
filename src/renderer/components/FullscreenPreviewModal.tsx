import { useState, useEffect } from 'react';
import { Modal, Stack, Text, Center, Box, Group, ActionIcon, Button } from '@mantine/core';
import type { FileRecord } from '@shared/types';
import type { LightingStyle } from '@shared/lighting-types';
import { isAudioExtension, isImageExtension } from '@shared/formats';
import { ModelViewer } from '../three/ModelViewer';
import { TextPreview } from './TextPreview';
import { AudioPlayer } from './AudioPlayer';
import { usePreferences } from '../util/use-preferences';
import { DEFAULT_RENDER_QUALITY } from '@shared/render-quality';

interface Props {
  opened: boolean;
  onClose: () => void;
  libraryId: string | null;
  file: FileRecord | null;
  lightingStyle: LightingStyle;
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
            maxWidth: '100%',
            maxHeight: '100%',
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
          background: 'rgba(16, 17, 19, 0.85)',
          padding: '4px 8px',
          borderRadius: 8,
          border: '1px solid #2C2E33',
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

/**
 * Spacebar-launched fullscreen viewer with balanced header margins.
 */
export function FullscreenPreviewModal({
  opened,
  onClose,
  libraryId,
  file,
  lightingStyle
}: Props) {
  const { prefs } = usePreferences();
  const renderQuality = prefs?.renderQuality ?? DEFAULT_RENDER_QUALITY;

  const modalStyles = {
    header: {
      padding: '12px 18px',
      background: '#101113',
      borderBottom: '1px solid #2C2E33'
    },
    title: {
      fontSize: '0.9rem',
      fontWeight: 600,
      color: '#C1C2C5'
    },
    close: {
      color: '#A6A7AB'
    },
    body: {
      height: 'calc(100vh - 53px)',
      padding: 0,
      overflow: 'hidden'
    },
    content: {
      background: '#101113',
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
      <div style={{ height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
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
            lightingStyle={lightingStyle}
            renderQuality={renderQuality}
          />
        )}
      </div>
    </Modal>
  );
}