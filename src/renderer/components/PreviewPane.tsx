import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AudioPlayer } from './AudioPlayer';
import { TextPreview } from './TextPreview';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCamera,
  IconRefresh,
  IconRotate2,
  IconRotateClockwise2
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { FileRecord } from '@shared/types';
import type { LightingStyle } from '@shared/lighting-types';
import { isAudioExtension, isImageExtension } from '@shared/formats';
import { LIGHTING_PRESETS } from '../three/lighting-presets';
import {
  UP_AXIS_OPTIONS,
  YAW_STEP_DEG,
  getDefaultOrientation,
  getYaw,
  rotateYaw,
  type UpAxis
} from '@shared/orientation';
import { ModelViewer, type ModelViewerHandle } from '../three/ModelViewer';
import { CropOverlay } from './CropOverlay';
import { ipc } from '../ipc-client';
import { usePreferences } from '../util/use-preferences';
import { DEFAULT_RENDER_QUALITY } from '@shared/render-quality';

// Helper to identify document/text extensions
const isTextExtension = (ext: string): boolean =>
  ['md', 'txt', 'json', 'log', 'yaml', 'yml', 'ini', 'cfg', 'markdown'].includes(
    ext.replace(/^\./, '').toLowerCase()
  );

interface Props {
  libraryId: string | null;
  file: FileRecord | null;
  selectionCount: number;
  lightingStyle: LightingStyle;
  onLightingStyleChange: (style: LightingStyle) => void;
  onRerenderThumb: (fileId: number) => void;
}

export function PreviewPane({
  libraryId,
  file,
  selectionCount,
  lightingStyle,
  onLightingStyleChange,
  onRerenderThumb
}: Props) {
  const viewerRef = useRef<ModelViewerHandle>(null);
  const { prefs } = usePreferences();
  const renderQuality = prefs?.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const [cropSize, setCropSize] = useState(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const attachWrapperRef = useCallback((el: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!el) {
      setCropSize(0);
      return;
    }
    const compute = () => {
      const rect = el.getBoundingClientRect();
      setCropSize(Math.floor(Math.min(rect.width, rect.height)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    resizeObserverRef.current = ro;
  }, []);

  if (!file || !libraryId) {
    return (
      <Center h="100%" p="md">
        <Text size="sm" c="dimmed">
          Select a file to preview.
        </Text>
      </Center>
    );
  }

  const isImage = isImageExtension(file.ext);
  const isAudio = isAudioExtension(file.ext);
  const isText = isTextExtension(file.ext);
  const is2DOrDoc = isImage || isAudio || isText;

  const yaw = getYaw(file.orientation);

  const setOrientation = (next: { upAxis?: UpAxis; yaw?: number }) => {
    void ipc.setFileOrientation(file.libraryId, file.id, {
      upAxis: next.upAxis ?? file.orientation.upAxis,
      yaw: next.yaw ?? yaw
    });
  };

  const handleRotate = (deltaDeg: number) => {
    setOrientation({ yaw: rotateYaw(yaw, deltaDeg) });
  };

  const handleCapture = async () => {
    try {
      const png = viewerRef.current?.hasModel()
        ? await viewerRef.current.captureCurrentFrame()
        : null;
      if (png && png.byteLength > 0) {
        const camera = viewerRef.current?.getCameraState() ?? null;
        await ipc.saveCustomThumbnail(file.libraryId, file.id, png, camera);
        return;
      }
    } catch (err) {
      notifications.show({
        color: 'orange',
        title: 'Capture failed, falling back to default-view re-render',
        message: (err as Error).message
      });
    }
    onRerenderThumb(file.id);
  };

  return (
    <Stack gap={0} h="100%">
      {/* Main Preview Container */}
      <div
        ref={attachWrapperRef}
        style={{ flex: 1, minHeight: 0, position: 'relative', background: '#101113' }}
      >
        {isAudio ? (
          <AudioPreview libraryId={libraryId} file={file} />
        ) : isText ? (
          <TextPreview libraryId={libraryId} file={file} />
        ) : (
          <ModelViewer
            ref={viewerRef}
            libraryId={libraryId}
            file={file}
            lightingStyle={lightingStyle}
            renderQuality={renderQuality}
          />
        )}

        {/* 3D Crop Overlay skipped for 2D/audio/text assets */}
        {!is2DOrDoc && <CropOverlay size={cropSize} />}

        {selectionCount > 1 && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              padding: '4px 8px',
              borderRadius: 4,
              background: 'rgba(0, 0, 0, 0.65)',
              color: 'var(--mantine-color-indigo-3)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              pointerEvents: 'none',
              fontFamily: 'var(--mantine-font-family-monospace, monospace)'
            }}
          >
            {selectionCount} selected
          </div>
        )}
      </div>

      {/* Control Strip */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 12px',
          borderTop: '1px solid var(--mantine-color-dark-4)',
          background: 'var(--mantine-color-dark-7)'
        }}
      >
        <Stack gap={8}>
          {/* Hide thumbnail render errors for 2D/Doc files */}
          {file.thumbError && !file.hasThumb && !is2DOrDoc && (
            <Alert
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={14} />}
              title="Thumbnail render failed"
              p="xs"
            >
              <Text size="xs" mb={6} style={{ wordBreak: 'break-word' }}>
                {file.thumbError}
              </Text>
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconRefresh size={12} />}
                onClick={() => onRerenderThumb(file.id)}
              >
                Retry render
              </Button>
            </Alert>
          )}

          {is2DOrDoc ? (
            <Group justify="flex-end" wrap="nowrap">
              <Badge variant="light" size="sm">
                .{file.ext}
              </Badge>
            </Group>
          ) : (
            <Group justify="space-between" wrap="nowrap" gap="md">
              <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                <ControlBlock label="Lighting" hint={LIGHTING_PRESETS.find((p) => p.id === lightingStyle)?.label}>
                  <SegmentedControl
                    size="xs"
                    value={lightingStyle}
                    onChange={(v) => onLightingStyleChange(v as LightingStyle)}
                    data={LIGHTING_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  />
                </ControlBlock>

                <ControlBlock
                  label="Up axis"
                  hint={
                    file.orientationCustomized ? (
                      <Text
                        span
                        size="xs"
                        c="indigo"
                        style={{ cursor: 'pointer' }}
                        onClick={() => void ipc.setFileOrientation(file.libraryId, file.id, null)}
                      >
                        reset (def {getDefaultOrientation(file.ext).upAxis})
                      </Text>
                    ) : (
                      file.orientation.upAxis
                    )
                  }
                >
                  <SegmentedControl
                    size="xs"
                    value={file.orientation.upAxis}
                    onChange={(v) => setOrientation({ upAxis: v as UpAxis })}
                    data={UP_AXIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                </ControlBlock>

                <ControlBlock label="Rotate" hint={`yaw ${yaw}°`}>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label={`Rotate ${YAW_STEP_DEG}° counter-clockwise`}>
                      <ActionIcon
                        variant="default"
                        size="md"
                        onClick={() => handleRotate(-YAW_STEP_DEG)}
                        aria-label={`Rotate counter-clockwise by ${YAW_STEP_DEG} degrees`}
                      >
                        <IconRotate2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={`Rotate ${YAW_STEP_DEG}° clockwise`}>
                      <ActionIcon
                        variant="default"
                        size="md"
                        onClick={() => handleRotate(YAW_STEP_DEG)}
                        aria-label={`Rotate clockwise by ${YAW_STEP_DEG} degrees`}
                      >
                        <IconRotateClockwise2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </ControlBlock>
              </Group>

              <Tooltip label="Capture current view as thumbnail">
                <ActionIcon
                  variant="light"
                  color="indigo"
                  size="lg"
                  onClick={() => void handleCapture()}
                  aria-label="Capture current view as thumbnail"
                >
                  <IconCamera size={18} />
                </ActionIcon>
              </Tooltip>

              <Badge variant="light" size="sm">
                .{file.ext}
              </Badge>
            </Group>
          )}
        </Stack>
      </div>
    </Stack>
  );
}

function AudioPreview({ libraryId, file }: { libraryId: string; file: FileRecord }) {
  const thumbSrc = file.hasThumb ? `wh3d-thumb://${libraryId}/${file.id}` : null;

  return (
    <Center h="100%" p="md">
      <Stack align="center" gap="lg" style={{ width: '100%', maxWidth: 500 }}>
        {/* Waveform Thumbnail Display (Border & Background Removed) */}
        {thumbSrc && (
          <Box
            style={{
              width: '100%',
              height: 280,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <img
              src={thumbSrc}
              alt={file.filename}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain'
              }}
            />
          </Box>
        )}

        {/* Player Controls */}
        <Box style={{ width: '100%' }}>
          <AudioPlayer
            libraryId={libraryId}
            fileId={file.id}
            filename={file.filename}
            thumbSrc={thumbSrc}
          />
        </Box>
      </Stack>
    </Center>
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