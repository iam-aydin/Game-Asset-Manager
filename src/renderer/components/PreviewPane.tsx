import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import { AudioPlayer } from './AudioPlayer';
import { AudioVisualizer } from './AudioVisualizer';
import { TextPreview } from './TextPreview';
import { VideoPlayer } from './VideoPlayer';
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
  Tooltip,
  useComputedColorScheme
} from '@mantine/core';
import {
  IconMaximize,
  IconMinimize,
  IconAlertTriangle,
  IconArrowRight,
  IconCamera,
  IconRefresh,
  IconX,
  IconPinned,
  IconPinnedOff
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { FileRecord } from '@shared/types';
import type { LightingStyle } from '@shared/lighting-types';
import { DEFAULT_HDRI, type HdriId } from '@shared/hdri';
import { isAudioExtension, isImageExtension, isVideoExtension } from '@shared/formats';
import { LIGHTING_PRESETS } from '../three/lighting-presets';
import { HDRI_PRESETS, getHdriPreset } from '../three/hdri-presets';
import { ModelViewer, type ModelViewerHandle } from '../three/ModelViewer';
import { CropOverlay } from './CropOverlay';
import { flushSync } from 'react-dom';
import {
  PREVIEW_TRANSITION,
  previewTransitionCss,
  pulseResizeBlur,
  runPreviewTransition
} from '@shared/transition';

// Applies a state change inside the animated preview transition. flushSync
// makes React commit it right away so the browser snapshots the new layout.
const animateLayout = (fn: () => void) => runPreviewTransition(() => flushSync(fn));
import { ipc } from '../ipc-client';
import { usePreferences, savePreferences } from '../util/use-preferences';
import { DEFAULT_RENDER_QUALITY } from '@shared/render-quality';

// Must match AppShell header height in App.tsx. The expanded video preview
// starts below the header so the search bar / top bar stay visible.
const APP_HEADER_HEIGHT = 88;

// Mini player header (the native OS title bar sits above it).
const MINI_HEADER_H = 28;

// Mini player body colors. These match --wh3d-viewport-bg in light.ts / dark.ts,
// but are picked from the live color scheme so the mini player follows the
// theme the moment it switches (video stays black, see containerStyle).
const MINI_BG_LIGHT = '#f1f2f4';
const MINI_BG_DARK = '#101113';

// How the preview fills the app window:
//   normal   = inside its pane
//   expanded = fills the editor below the header (T key / top-right button)
//   full     = fills the whole app window, header included (F key / fullscreen button)
// Both expanded and full animate through animateLayout (see transition.ts).
type PreviewLayout = 'normal' | 'expanded' | 'full';

// Helper to identify document/text extensions
const isTextExtension = (ext: string): boolean =>
  ['md', 'txt', 'json', 'log', 'yaml', 'yml', 'ini', 'cfg', 'markdown'].includes(
    ext.replace(/^\./, '').toLowerCase()
  );

interface Props {
  onMaximize?: () => void;
  libraryId: string | null;
  file: FileRecord | null;
  selectionCount: number;
  lightingStyle: LightingStyle;
  onLightingStyleChange: (style: LightingStyle) => void;
  onRerenderThumb: (fileId: number) => void;
  /** Set by App when an audio OR video tile is clicked; drives autoplay. */
  activeAudio?: { fileId: number; autoPlay: boolean } | null;
  /** Fired when the window enters/leaves the mini player (App blocks its
   *  global shortcuts while true). */
  onMiniModeChange?: (mini: boolean) => void;
  /** The same theme button/dropdown the main toolbar uses. Rendered in the
   *  mini player header, just left of the back button. */
  themeButton?: ReactNode;
}

export function PreviewPane({
  onMaximize,
  libraryId,
  file,
  selectionCount,
  lightingStyle,
  onLightingStyleChange,
  onRerenderThumb,
  activeAudio,
  onMiniModeChange,
  themeButton
}: Props) {
  const viewerRef = useRef<ModelViewerHandle>(null);
  const { prefs } = usePreferences();
  const colorScheme = useComputedColorScheme('dark');
  const miniBg = colorScheme === 'light' ? MINI_BG_LIGHT : MINI_BG_DARK;
  const renderQuality = prefs?.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const hdri: HdriId = prefs?.hdri ?? DEFAULT_HDRI;
  const showGrid = prefs?.showGrid ?? false;
  const [cropSize, setCropSize] = useState(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Mini player mode (I key): the whole Electron window shrinks into a small
  // always-on-top player, and this preview fills it. Works for every type.
  const [mini, setMini] = useState(false);
  const miniRef = useRef(false);
  const onMiniModeChangeRef = useRef(onMiniModeChange);
  onMiniModeChangeRef.current = onMiniModeChange;

  // Video/audio "expand" and "fullscreen": the preview fills the app window
  // without using real OS/browser fullscreen, so both can be animated.
  const [layout, setLayout] = useState<PreviewLayout>('normal');
  const layoutRef = useRef<PreviewLayout>('normal');
  layoutRef.current = layout;
  // Every expand/shrink/fullscreen goes through these so it gets the animation
  // (see transition.ts). Both do nothing while the mini player is active.
  const toggleExpanded = useCallback(() => {
    if (miniRef.current) return;
    animateLayout(() => setLayout((m) => (m === 'normal' ? 'expanded' : 'normal')));
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (miniRef.current) return;
    animateLayout(() => setLayout((m) => (m === 'full' ? 'normal' : 'full')));
  }, []);

  // Always-on-top applies to the mini player only. Default ON each time you
  // enter it; Ctrl+T toggles it.
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const transitioningRef = useRef(false);
  // A toggle requested while the window is still animating. Instead of being
  // dropped (which made the button feel like it needed two clicks), it is
  // remembered and applied as soon as the current transition finishes.
  const pendingRef = useRef<boolean | null>(null);

  const applyMini = useCallback((on: boolean) => {
    if (on === miniRef.current) return;
    miniRef.current = on;
    transitioningRef.current = true;
    pulseResizeBlur(); // frost the window before the layout swaps / window resizes

    const done = () => {
      transitioningRef.current = false;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued !== null && queued !== miniRef.current) applyMini(queued);
    };

    if (on) {
      // Swap to the player layout immediately; the window shrinks around it.
      pinnedRef.current = true;
      setPinned(true);
      setMini(true);
      onMiniModeChangeRef.current?.(true);
      void ipc.setMiniMode(true).finally(done);
    } else {
      // Keep the player layout until the window has finished growing back.
      void ipc.setMiniMode(false).finally(() => {
        pulseResizeBlur(); // cover the layout swap back to the full UI
        setMini(false);
        onMiniModeChangeRef.current?.(false);
        done();
      });
    }
  }, []);

  const toggleMini = useCallback(
    (next?: boolean) => {
      const want = next ?? !miniRef.current;
      if (transitioningRef.current) {
        pendingRef.current = want;
        return;
      }
      applyMini(want);
    },
    [applyMini]
  );

  const togglePinned = useCallback(() => {
    if (!miniRef.current) return;
    const next = !pinnedRef.current;
    pinnedRef.current = next;
    setPinned(next);
    void ipc.setMiniAlwaysOnTop(next);
  }, []);
  // Never leave the window stuck small/on-top if this component unmounts.
  useEffect(() => {
    return () => {
      if (miniRef.current) {
        miniRef.current = false;
        onMiniModeChangeRef.current?.(false);
        void ipc.setMiniMode(false);
      }
    };
  }, []);

  const hasFile = !!file && !!libraryId;
  const isVideoFile = !!file && isVideoExtension(file.ext);
  const isAudioFile = !!file && isAudioExtension(file.ext);

  // Keyboard: T = expand (same as the top-right button), F = fullscreen
  // (audio here, video handles its own F in VideoPlayer), I = mini player,
  // Esc = close any of them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
          return;
        }
      }
      // Ctrl+T: toggle always-on-top (mini player only).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        if (miniRef.current) {
          e.preventDefault();
          if (!e.repeat) togglePinned();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;

      if (e.key === 'Escape') {
        if (document.fullscreenElement) return;
        if (layoutRef.current !== 'normal') animateLayout(() => setLayout('normal'));
        if (miniRef.current) toggleMini(false);
        return;
      }
      if (!hasFile) return;

      const key = e.key.toLowerCase();
      if (key === 't') {
        e.preventDefault();
        if (miniRef.current) return;
        // T does nothing for audio (its fullscreen is F).
        if (isAudioFile) return;
        if (isVideoFile) toggleExpanded();
        else onMaximize?.();
      } else if (key === 'f' && isAudioFile) {
        // Audio fullscreen is F only (video handles its own F in VideoPlayer).
        e.preventDefault();
        toggleFullscreen();
      } else if (key === 'i') {
        e.preventDefault();
        setLayout('normal');
        toggleMini();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    hasFile,
    isVideoFile,
    isAudioFile,
    onMaximize,
    toggleMini,
    toggleExpanded,
    toggleFullscreen,
    togglePinned
  ]);

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
  const isVideo = isVideoExtension(file.ext);
  const is2DOrDoc = isImage || isAudio || isText || isVideo;

  // Mini wins over expanded/full. They only apply to video and audio, so
  // selecting any other file automatically drops back to the normal layout.
  const isPopped = layout !== 'normal' && (isVideo || isAudio) && !mini;
  const isFull = isPopped && layout === 'full';

  // Same rule for audio and video: autoplay only when this exact file was
  // just clicked (not on the initial folder auto-select, not on shift/ctrl).
  const autoPlay = activeAudio?.fileId === file.id ? activeAudio.autoPlay : false;

  // The HDRI choice is a global preference (not per file) and persists
  // across restarts. Wait until the prefs have loaded before writing, so we
  // never overwrite the file with an empty object.
  const handleHdriChange = (next: HdriId) => {
    if (!prefs) return;
    void savePreferences({ ...prefs, hdri: next });
  };

  const handleGridChange = (on: boolean) => {
    if (!prefs) return;
    void savePreferences({ ...prefs, showGrid: on });
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

  // Videos expand in place; everything else keeps opening the modal viewer.
  const handleMaximizeClick = () => {
    if (isVideo) {
      toggleExpanded();
    } else {
      onMaximize?.();
    }
  };

  const containerStyle: CSSProperties = mini
    ? {
        // Fills the (now small) window, covering the whole manager UI.
        position: 'fixed',
        inset: 0,
        zIndex: 160,
        display: 'flex',
        flexDirection: 'column',
        // Video keeps its black letterbox; everything else follows the theme.
        background: isVideo ? '#000' : miniBg
      }
    : isPopped
      ? {
          position: 'fixed',
          // Expanded stops under the header; fullscreen covers the whole window.
          top: isFull ? 0 : APP_HEADER_HEIGHT,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 150,
          display: 'flex',
          flexDirection: 'column',
          background: isVideo ? '#000' : 'var(--wh3d-viewport-bg)'
        }
      : {
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--wh3d-viewport-bg)'
        };

  // Lets the browser morph this element between normal / expanded / full layouts.
  const animatedContainerStyle = {
    ...containerStyle,
    viewTransitionName: PREVIEW_TRANSITION.name
  } as CSSProperties;

  return (
    <Stack gap={0} h="100%">
      <style>{previewTransitionCss()}</style>
      {/* Main Preview Container (same element in every mode, so players and the
          3D viewer never remount when switching between normal/expanded/full/mini) */}
      <div style={animatedContainerStyle}>
        {mini && (
          <div
            style={{
              height: MINI_HEADER_H,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              // No right padding: the back button sits flush in the corner
              padding: '0 0 0 10px',
              background: 'var(--mantine-color-dark-7)',
              borderBottom: '1px solid var(--mantine-color-dark-4)',
              userSelect: 'none'
            }}
          >
            {/* Back button: rounded top-right corner (matches the window's
                corner), red on hover, same in light and dark */}
            <style>{`
              .gam-mini-back {
                border-radius: 0 8px 0 0 !important;
              }
              .gam-mini-back:hover {
                background-color: #f30000b0 !important;
                color: #ffffff !important;
              }
            `}</style>
            <Text size="xs" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
              {file.filename}
            </Text>
            <Tooltip
              label={pinned ? 'Always on top: ON (Ctrl+T)' : 'Always on top: OFF (Ctrl+T)'}
              withinPortal
            >
              <ActionIcon
                variant={pinned ? 'light' : 'subtle'}
                color={pinned ? 'indigo' : 'gray'}
                size="sm"
                onClick={togglePinned}
                aria-label="Toggle always on top"
              >
                {pinned ? <IconPinned size={14} /> : <IconPinnedOff size={14} />}
              </ActionIcon>
            </Tooltip>
            {/* Same theme button + dropdown as the main toolbar */}
            {themeButton}
            <Tooltip label="Back to full window (I / Esc)" withinPortal>
              <ActionIcon
                className="gam-mini-back"
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => toggleMini(false)}
                aria-label="Back to full window"
                style={{ width: 34, height: MINI_HEADER_H }}
              >
                <IconArrowRight size={14} />
              </ActionIcon>
            </Tooltip>
          </div>
        )}

        <div
          ref={attachWrapperRef}
          style={{ flex: 1, minHeight: 0, position: 'relative', background: 'inherit' }}
        >
          {isVideo ? (
            <VideoPlayer
              key={file.id}
              libraryId={libraryId}
              fileId={file.id}
              filename={file.filename}
              ext={file.ext}
              autoPlay={autoPlay}
              onMini={() => {
                setLayout('normal');
                toggleMini();
              }}
              isMini={mini}
              onFullscreen={toggleFullscreen}
              isFullscreen={isFull}
            />
          ) : isAudio ? (
            <AudioPreview
              libraryId={libraryId}
              file={file}
              activeAudio={activeAudio}
              onMini={() => {
                setLayout('normal');
                toggleMini();
              }}
              isMini={mini}
              onFullscreen={toggleFullscreen}
              isFullscreen={isFull}
            />
          ) : isText ? (
            <TextPreview libraryId={libraryId} file={file} />
          ) : (
            <ModelViewer
              ref={viewerRef}
              libraryId={libraryId}
              file={file}
              lightingStyle={lightingStyle}
              hdri={hdri}
              showGrid={showGrid}
              renderQuality={renderQuality}
            />
          )}

          {/* 3D Crop Overlay skipped for 2D/audio/text/video assets */}
          {!is2DOrDoc && <CropOverlay size={cropSize} />}

          {(onMaximize || isVideo) && !isAudio && !mini && (
            <Tooltip
              label={
                isVideo
                  ? isPopped
                    ? 'Shrink (T / Esc)'
                    : 'Expand (T)'
                  : 'Fullscreen viewer (T)'
              }
              withinPortal
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="md"
                onClick={handleMaximizeClick}
                aria-label={isPopped ? 'Shrink preview' : 'Expand preview'}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
                  border: '1px solid var(--wh3d-overlay-border, #2C2E33)',
                  zIndex: 5
                }}
              >
                {isPopped ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
              </ActionIcon>
            </Tooltip>
          )}

          {selectionCount > 1 && !mini && (
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
      </div>

      {/* Placeholder left behind in the pane while the preview is popped out */}
      {(mini || isPopped) && (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Text size="xs" c="dimmed">
            {mini
              ? 'Player mode is active (I or Esc to return)'
              : isFull
                ? 'Preview fullscreen (F or Esc to close)'
                : 'Preview expanded (T or Esc to close)'}
          </Text>
        </Center>
      )}

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
                <ControlBlock
                  label="View"
                  hint={LIGHTING_PRESETS.find((p) => p.id === lightingStyle)?.label}
                >
                  <SegmentedControl
                    size="xs"
                    value={lightingStyle}
                    onChange={(v) => onLightingStyleChange(v as LightingStyle)}
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

function AudioPreview({
  libraryId,
  file,
  activeAudio,
  onMini,
  isMini,
  onFullscreen,
  isFullscreen
}: {
  libraryId: string;
  file: FileRecord;
  activeAudio?: { fileId: number; autoPlay: boolean } | null;
  /** Enter/leave the mini player from the audio player's own button. */
  onMini?: () => void;
  isMini?: boolean;
  /** Fill the whole app window (animated, same as video's F). */
  onFullscreen?: () => void;
  isFullscreen?: boolean;
}) {
  const thumbSrc = file.hasThumb ? `wh3d-thumb://${libraryId}/${file.id}` : null;
  const autoPlay = activeAudio?.fileId === file.id ? activeAudio.autoPlay : false;

  return (
    <Stack h="100%" p="sm" gap="sm" style={{ minHeight: 0 }}>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <AudioVisualizer bars={44} height="100%" />
      </Box>
      <Box style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <AudioPlayer
          key={file.id}
          libraryId={libraryId}
          fileId={file.id}
          filename={file.filename}
          thumbSrc={thumbSrc}
          showHero={false}
          autoPlay={autoPlay}
          onMini={onMini}
          isMini={isMini}
          onFullscreen={onFullscreen}
          isFullscreen={isFullscreen}
        />
      </Box>
    </Stack>
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