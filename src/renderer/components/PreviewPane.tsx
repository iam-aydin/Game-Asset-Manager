import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import { AudioPlayer } from './AudioPlayer';
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
  IconChevronDown,
  IconChevronUp,
  IconRefresh,
  IconPictureInPicture,
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
import {
  GLASS_BUTTON_CLASS,
  GLASS_RING_BUTTON_CLASS,
  GLASS_RING_CLASS
} from './Glasseffect';
import { flushSync } from 'react-dom';
import {
  MINI_CHROME_TRANSITION,
  PREVIEW_TRANSITION,
  VIDEO_COMPACT_BAR,
  miniChromeCss,
  miniChromeTransition,
  videoChromeTransition,
  previewTransitionCss,
  pulseResizeBlur,
  runPreviewTransition
} from '@shared/transition';

// Applies a state change inside the animated preview transition. flushSync
// makes React commit it right away so the browser snapshots the new layout.
const animateLayout = (fn: () => void) => runPreviewTransition(() => flushSync(fn));
import { ipc } from '../ipc-client';
import { usePreferences, savePreferences } from '../util/use-preferences';
import { useVerticalDragGesture } from '../util/gestures';
import { DEFAULT_RENDER_QUALITY } from '@shared/render-quality';

// Must match AppShell header height in App.tsx. The expanded video preview
// starts below the header so the search bar / top bar stay visible.
const APP_HEADER_HEIGHT = 88;

// Mini player header (the native OS title bar sits above it).
const MINI_HEADER_H = 28;

// GAM-MINI-IDLE: the mini player opens with its options hidden (O key / eye button toggles).
const MINI_OPTIONS_HIDDEN_BY_DEFAULT = true;

/** Arrow pair icon for the mini player's hide / show interface button.
 *  Shown state (click to hide): arrows pointing outward, "← →", as the bars
 *  slide off to the edges. Hidden state (click to show): inward, "→ ←". */
function ChromeToggleIcon({ hidden, size = 14 }: { hidden: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {hidden ? (
        <>
          <path d="M3 12h7M7 8l3 4-3 4" />
          <path d="M21 12h-7M17 8l-3 4 3 4" />
        </>
      ) : (
        <>
          <path d="M10 12H3M6 8l-3 4 3 4" />
          <path d="M14 12h7M18 8l3 4-3 4" />
        </>
      )}
    </svg>
  );
}

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
  ['md', 'txt', 'json', 'log', 'yaml', 'yml', 'ini', 'cfg', 'markdown', 'html', 'htm', 'xhtml'].includes(
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
  // Thumbnail frame (aspect-ratio overlay). Toggled by clicking the ring around
  // the camera button. Always starts hidden and is not saved between launches.
  const [showFrame, setShowFrame] = useState(false);
  // Single click = frame on for the current file only (resets when another file
  // is previewed). Double-click = "sticky": the frame stays on for every file
  // until it is clicked off. Neither is saved between launches.
  const [frameSticky, setFrameSticky] = useState(false);
  const frameStickyRef = useRef(false);
  frameStickyRef.current = frameSticky;
  const previewedFileId = file?.id ?? null;
  useEffect(() => {
    if (!frameStickyRef.current) setShowFrame(false);
  }, [previewedFileId]);

  // Mini player mode (I key): the whole Electron window shrinks into a small
  // always-on-top player, and this preview fills it. Works for every type.
  const [mini, setMini] = useState(false);
  const miniRef = useRef(false);
  const onMiniModeChangeRef = useRef(onMiniModeChange);
  onMiniModeChangeRef.current = onMiniModeChange;

  // Mini player only: Environment + Grid are collapsed by default (only View
  // is shown) and this toggles them open. Resets whenever mini closes.
  const [miniMore, setMiniMore] = useState(false);
  // Mini player only: the eye button hides the filename/header background and
  // the control strip until it is clicked again (the header buttons stay).
  const [miniChromeHidden, setMiniChromeHidden] = useState(false);
  useEffect(() => {
    if (!mini) {
      setMiniMore(false);
      setMiniChromeHidden(false);
    } else {
      setMiniChromeHidden(MINI_OPTIONS_HIDDEN_BY_DEFAULT);
    }
  }, [mini]);

  // GAM-MINI-IDLE: with the options hidden, the header buttons fade out after 1 s
  // without mouse movement (same rule as the video slider) and return on movement.
  const [miniUiShown, setMiniUiShown] = useState(true);
  const miniUiHoverRef = useRef(false);
  const miniUiTimerRef = useRef<number | undefined>(undefined);
  const armMiniUiHide: () => void = useCallback(() => {
    window.clearTimeout(miniUiTimerRef.current);
    miniUiTimerRef.current = window.setTimeout(() => {
      if (miniUiHoverRef.current) {
        armMiniUiHide();
        return;
      }
      setMiniUiShown(false);
    }, VIDEO_COMPACT_BAR.autoHideMs);
  }, []);
  useEffect(() => {
    window.clearTimeout(miniUiTimerRef.current);
    setMiniUiShown(true);
    if (!(mini && miniChromeHidden)) return undefined;
    // Let the hide animation finish, then start the 1 s countdown.
    miniUiTimerRef.current = window.setTimeout(armMiniUiHide, VIDEO_COMPACT_BAR.durationMs);
    return () => window.clearTimeout(miniUiTimerRef.current);
  }, [mini, miniChromeHidden, armMiniUiHide]);
  const handleMiniPointerMove = () => {
    if (!(mini && miniChromeHidden)) return;
    setMiniUiShown(true);
    armMiniUiHide();
  };

  // Video/audio/3D "expand" and "fullscreen": the preview fills the app window
  // without using real OS/browser fullscreen, so both can be animated.
  const [layout, setLayout] = useState<PreviewLayout>('normal');
  const layoutRef = useRef<PreviewLayout>('normal');
  layoutRef.current = layout;
  // Every expand/shrink/fullscreen goes through these so it gets the animation
  // (see transition.ts). Both do nothing while the mini player is active.

  // Always-on-top applies to the mini player only. Default ON each time you
  // enter it; Ctrl+T toggles it.
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const transitioningRef = useRef(false);
  // A toggle requested while the window is still animating. Instead of being
  // dropped (which made the button feel like it needed two clicks), it is
  // remembered and applied as soon as the current transition finishes.
  const pendingRef = useRef<boolean | null>(null);
  // Layout to land in once the mini player has closed (F / T pressed, or the
  // drag-up gesture, while in mini). It is applied in the SAME React commit
  // that leaves mini, so the preview never flashes through the normal layout
  // and never starts a view transition while the window is still resizing.
  const afterMiniRef = useRef<PreviewLayout | null>(null);

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
      // A stale "after mini" request must not fire on the next close.
      afterMiniRef.current = null;
      // Swap to the player layout immediately; the window shrinks around it.
      pinnedRef.current = true;
      setPinned(true);
      setMini(true);
      onMiniModeChangeRef.current?.(true);
      void ipc.setMiniMode(true).finally(done);
    } else {
      void ipc.setMiniMode(false).finally(() => {
        pulseResizeBlur();
        const target = afterMiniRef.current;
        afterMiniRef.current = null;
        // One commit: leave mini AND go to the requested layout (if any).
        flushSync(() => {
          setMini(false);
          if (target) setLayout(target);
        });
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
  const toggleExpanded = useCallback(() => {
    if (miniRef.current) {
      afterMiniRef.current = 'expanded';
      toggleMini(false);
      return;
    }
    animateLayout(() => setLayout((m) => (m === 'normal' ? 'expanded' : 'normal')));
  }, [toggleMini]);

  const toggleFullscreen = useCallback(() => {
    if (miniRef.current) {
      afterMiniRef.current = 'full';
      toggleMini(false);
      return;
    }
    animateLayout(() => setLayout((m) => (m === 'full' ? 'normal' : 'full')));
  }, [toggleMini]);
  
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
  const isTextFile = !!file && isTextExtension(file.ext);
  const isImageFile = !!file && isImageExtension(file.ext);
  // Anything that is not video/audio/text/image is a 3D model.
  const isModelFile = hasFile && !isVideoFile && !isAudioFile && !isTextFile && !isImageFile;

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
      // O: hide / show the options (mini player only).
      if (key === 'o') {
        if (miniRef.current) {
          e.preventDefault();
          if (!isVideoFile && !isAudioFile) pulseResizeBlur();
          setMiniChromeHidden((v) => !v);
        }
        return;
      }
      if (key === 't') {
        e.preventDefault();
        // T does nothing for audio (its fullscreen is F).
        if (isAudioFile) return;
        // Video, 3D models, images and text all expand in place (animated).
        if (isVideoFile || isModelFile || isImageFile || isTextFile) toggleExpanded();
        else onMaximize?.();
      } else if (key === 'f' && (isImageFile || isTextFile)) {
        // Images and text: F = fullscreen (covers the header too), like video.
        e.preventDefault();
        toggleFullscreen();
      } else if (key === 'f' && isModelFile) {
        // For 3D models F does exactly what T does (animated in-place expand).
        e.preventDefault();
        toggleExpanded();
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
    isModelFile,
    isImageFile,
    isTextFile,
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
  const isModel = !is2DOrDoc;

  // Mini wins over expanded/full. Expand applies to video, audio and 3D
  // models, so selecting an image/text file drops back to the normal layout.
  const isPopped = layout !== 'normal' && !mini;
  const isFull = isPopped && layout === 'full';

  // For 3D models the control strip (view / environment / grid / capture)
  // moves inside the popped-out container so it stays visible while the
  // container is position: fixed (expanded or mini player).
  const stripInside = isModel && (mini || isPopped);

  // Interface hidden in the mini player (3D models only).
  const hideChrome = mini && miniChromeHidden;
  const videoCompact = hideChrome && isVideo;
  const audioCompact = hideChrome && isAudio;

  // GAM-COMPACT-V2: video files use the long 1.25 s timeline for the header too.
  const chromeT = (...props: string[]) =>
    isVideo || isAudio ? videoChromeTransition(...props) : miniChromeTransition(...props);


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

  // Videos and 3D models expand in place; everything else keeps opening the
  // modal viewer.
  const handleMaximizeClick = () => {
    if (isVideo || isModel || isImage || isText) {
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

  // View / environment / grid / capture controls. Rendered either inside the
  // popped-out container (3D expanded or mini) or in the pane (normal).
  const controlStrip = (
    <div
      style={{
        flexShrink: 0,
        padding: mini ? '6px 10px' : '8px 12px',
        borderTop: '1px solid var(--mantine-color-dark-4)',
        background: 'var(--mantine-color-dark-7)'
      }}
    >
      <Stack gap={8}>
        {/* Hide thumbnail render errors for 2D/Doc files (and in the tiny mini player) */}
        {file.thumbError && !file.hasThumb && !is2DOrDoc && !mini && (
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
          <>
            <Group justify="space-between" wrap="nowrap" gap={mini ? 'xs' : 'md'}>
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

                {/* Environment + Grid: always visible except in the mini player,
                    where they collapse behind the "More" button. */}
                {!mini && (
                  <>
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
                  </>
                )}
              </Group>

              <Group gap="xs" wrap="nowrap">
                {mini && (
                  <Tooltip
                    label={miniMore ? 'Hide environment & grid' : 'Show environment & grid'}
                    withinPortal
                  >
                    <Button
                      variant="subtle"
                      color="gray"
                      size="compact-xs"
                      onClick={() => setMiniMore((v) => !v)}
                      rightSection={
                        miniMore ? <IconChevronDown size={12} /> : <IconChevronUp size={12} />
                      }
                      aria-label="Toggle environment and grid options"
                      aria-expanded={miniMore}
                    >
                      More
                    </Button>
                  </Tooltip>
                )}
                {/* Ring around the camera: clicking the ring shows/hides the
                    thumbnail frame, clicking the camera inside captures. */}
                <Tooltip
                  label={
                    showFrame
                      ? frameSticky
                        ? 'Ring: click to turn the frame off · Camera: capture thumbnail'
                        : 'Ring: click to hide, double-click to keep it on for every file · Camera: capture'
                      : 'Ring: click to show the frame (this file only), double-click to keep it on for every file · Camera: capture'
                  }
                  withinPortal
                >
                  <div
                    className={GLASS_RING_CLASS}
                    data-active={showFrame ? 'true' : 'false'}
                    data-sticky={frameSticky ? 'true' : 'false'}
                    role="button"
                    aria-pressed={showFrame}
                    aria-label="Toggle thumbnail frame"
                    onClick={() => {
                      // Turning it off by click also clears "sticky".
                      if (showFrame) setFrameSticky(false);
                      setShowFrame((v) => !v);
                    }}
                    onDoubleClick={() => {
                      // Two clicks in a row: keep the frame on across files.
                      setShowFrame(true);
                      setFrameSticky(true);
                    }}
                    style={{
                      position: 'relative',
                      padding: 4,
                      borderRadius: 10,
                      cursor: 'pointer',
                      display: 'flex'
                    }}
                  >
                    <ActionIcon
                      className={GLASS_RING_BUTTON_CLASS}
                      variant="light"
                      color="indigo"
                      size={mini ? 'md' : 'lg'}
                      onClick={(e) => {
                        // Don't let the capture click also toggle the frame.
                        e.stopPropagation();
                        void handleCapture();
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      aria-label="Capture current view as thumbnail"
                    >
                      <IconCamera size={mini ? 16 : 18} />
                    </ActionIcon>
                  </div>
                </Tooltip>

                {!mini && (
                  <Badge variant="light" size="sm">
                    .{file.ext}
                  </Badge>
                )}
              </Group>
            </Group>

            {mini && miniMore && (
              <Group gap="md" wrap="wrap">
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
            )}
          </>
        )}
      </Stack>
    </div>
  );

  return (
    <Stack gap={0} h="100%">
      <style>{previewTransitionCss()}</style>
      <style>{miniChromeCss()}</style>
      {/* Main Preview Container (same element in every mode, so players and the
          3D viewer never remount when switching between normal/expanded/full/mini) */}
      <div
        style={animatedContainerStyle}
        data-mini-chrome={hideChrome ? 'hidden' : 'shown'}
        onMouseMove={handleMiniPointerMove}
      >
        {mini && (
          // Outer box takes the header's space in the layout and animates to 0
          // when the interface is hidden, so the viewer grows to fill it. The
          // bar inside is absolutely positioned, so its buttons keep their
          // place and float over the viewer.
          <div
            style={{
              position: 'relative',
              zIndex: 20,
              flexShrink: 0,
              height: hideChrome ? 0 : MINI_HEADER_H,
              transition: chromeT('height')
            }}
          >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: MINI_HEADER_H,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              // No right padding: the back button sits flush in the corner
              padding: '0 0 0 10px',
              userSelect: 'none'
            }}
          >
            {/* Header background + bottom border: slides up to the top edge and
                fades out when the interface is hidden */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--mantine-color-dark-7)',
                borderBottom: '1px solid var(--mantine-color-dark-4)',
                opacity: hideChrome ? 0 : 1,
                transform: hideChrome ? 'translateY(-100%)' : 'translateY(0)',
                transition: chromeT('opacity', 'transform'),
                pointerEvents: 'none'
              }}
            />
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
            {/* Filename: slides toward the left edge and fades out */}
            <Text
              size="xs"
              fw={600}
              truncate
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                opacity: hideChrome ? 0 : 1,
                transform: hideChrome
                  ? `translateX(-${MINI_CHROME_TRANSITION.titleSlidePx}px)`
                  : 'translateX(0)',
                transition: chromeT('opacity', 'transform'),
                pointerEvents: 'none'
              }}
            >
              {file.filename}
            </Text>

            {/* Header buttons: never hidden. When the interface is hidden they
                get their own backing so they stay readable over the viewer. */}
            <div
              onMouseEnter={() => {
                miniUiHoverRef.current = true;
              }}
              onMouseLeave={() => {
                miniUiHoverRef.current = false;
                if (mini && miniChromeHidden) armMiniUiHide();
              }}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: MINI_HEADER_H,
                paddingLeft: 6,
                opacity: hideChrome && !miniUiShown ? 0 : 1,
                pointerEvents: hideChrome && !miniUiShown ? 'none' : 'auto',
                filter: hideChrome && !miniUiShown ? 'blur(4px)' : 'none',
                borderRadius: '0 0 0 8px',
                // GAM-HEADER-GLASS: buttons stay; when the interface is hidden they sit on glass.
                background: hideChrome ? 'rgba(128, 128, 128, 0.16)' : 'transparent',
                backdropFilter: hideChrome ? 'blur(16px) saturate(170%)' : 'none',
                WebkitBackdropFilter: hideChrome ? 'blur(16px) saturate(170%)' : 'none',
                boxShadow: hideChrome
                  ? 'inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 6px 18px rgba(0, 0, 0, 0.28)'
                  : 'none',
                borderLeft: hideChrome ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid transparent',
                borderBottom: hideChrome ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid transparent',
                transition:
                  chromeT('background-color', 'background', 'backdrop-filter', '-webkit-backdrop-filter', 'box-shadow', 'border-color') +
                  ', opacity 260ms ease, filter 260ms ease'
              }}
            >
              {/* Shown for every file type. For 3D models it hides the file
                  name bar and the control panel; for everything else only the
                  file name bar. */}
              {(
                <Tooltip
                  label={
                    hideChrome ? 'Show options (O)' : 'Hide options (O)'
                  }
                  withinPortal
                >
                  <ActionIcon
                    variant="subtle"
                    color={hideChrome ? 'indigo' : 'gray'}
                    size="sm"
                    onClick={() => {
                      // Frost the whole window while the interface collapses/returns,
                      // same blur layer the expand / mini-player changes use.
                      if (!isVideo && !isAudio) pulseResizeBlur();
                      setMiniChromeHidden((v) => !v);
                    }}
                    aria-label={hideChrome ? 'Show options' : 'Hide options'}
                    aria-pressed={hideChrome}
                  >
                    <ChromeToggleIcon hidden={hideChrome} size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip
                label={pinned ? 'Always on top: ON (Ctrl+T)' : 'Always on top: OFF (Ctrl+T)'}
                withinPortal
              >
                <ActionIcon
                  variant="subtle"
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
          </div>
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
              compact={videoCompact}
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
              compact={audioCompact}
            />
          ) : isText ? (
            // The expand / mini buttons live inside the text card's header, to
            // the left of its copy button, so no side space is reserved.
            <TextPreview
              libraryId={libraryId}
              file={file}
              actions={
                mini ? undefined : (
                  <>
                    <Tooltip
                      label={isPopped ? 'Shrink (T / Esc)' : 'Expand (T) · Fullscreen (F)'}
                      withinPortal
                    >
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={handleMaximizeClick}
                        aria-label={isPopped ? 'Shrink preview' : 'Expand preview'}
                      >
                        {isPopped ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Mini player (I)" withinPortal>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={() => {
                          setLayout('normal');
                          toggleMini();
                        }}
                        aria-label="Open mini player"
                      >
                        <IconPictureInPicture size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                )
              }
            />
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

          {/* Thumbnail frame, only for 3D models and only when toggled on */}
          {!is2DOrDoc && showFrame && <CropOverlay size={cropSize} />}

          {!isAudio && !isText && !mini && (
            <Tooltip
              label={
                isModel
                  ? isPopped
                    ? 'Shrink (T / F / Esc)'
                    : 'Expand (T / F)'
                  : isPopped
                    ? 'Shrink (T / Esc)'
                    : isVideo
                      ? 'Expand (T)'
                      : 'Expand (T) · Fullscreen (F)'
              }
              position="left"
              withinPortal
            >
              <ActionIcon
                className={GLASS_BUTTON_CLASS}
                variant="subtle"
                color="gray"
                size="md"
                onClick={handleMaximizeClick}
                aria-label={isPopped ? 'Shrink preview' : 'Expand preview'}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 5
                }}
              >
                {isPopped ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
              </ActionIcon>
            </Tooltip>
          )}

          {/* Mini player button, just under the expand button (every type except
              audio, which has its own mini button inside its player) */}
          {!isAudio && !isText && !mini && (
            <Tooltip label="Mini player (I)" position="left" withinPortal>
              <ActionIcon
                className={GLASS_BUTTON_CLASS}
                variant="subtle"
                color="gray"
                size="md"
                onClick={() => {
                  setLayout('normal');
                  toggleMini();
                }}
                aria-label="Open mini player"
                style={{
                  position: 'absolute',
                  top: 42,
                  right: 8,
                  zIndex: 5
                }}
              >
                <IconPictureInPicture size={16} />
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

        {/* 3D controls ride along inside the popped-out container */}
        {stripInside && (
          // Collapses by animating its row height to 0 while the content slides
          // down and fades, so the panel "goes down and disappears".
          <div
            style={{
              display: 'grid',
              flexShrink: 0,
              gridTemplateRows: hideChrome ? '0fr' : '1fr',
              transition: chromeT('grid-template-rows')
            }}
          >
            <div
              style={{
                minHeight: 0,
                overflow: 'hidden',
                opacity: hideChrome ? 0 : 1,
                transform: hideChrome
                  ? `translateY(${MINI_CHROME_TRANSITION.stripSlidePercent}%)`
                  : 'translateY(0)',
                transition: chromeT('opacity', 'transform')
              }}
            >
              {controlStrip}
            </div>
          </div>
        )}
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

      {/* Control Strip (normal layout only; popped-out 3D renders it inside) */}
      {!stripInside && controlStrip}
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
  isFullscreen,
  compact
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
  /** Mini player with the interface hidden: the bar collapses to the seek slider. */
  compact: boolean;
}) {
  const autoPlay = activeAudio?.fileId === file.id ? activeAudio.autoPlay : false;

  // Same drag gesture as the video player: up = fullscreen, down = mini player.
  const gesture = useVerticalDragGesture({
    onGesture: (dir) => {
      if (dir === 'up') {
        if (!isFullscreen) onFullscreen?.();
      } else if (!isMini) {
        onMini?.();
      }
    }
  });

  // The player draws its own visualizer stage and floats the bar over the
  // bottom of it, so this only supplies the gesture wrapper.
  return (
    <Box
      onMouseDown={gesture.onMouseDown}
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      <AudioPlayer
        key={file.id}
        libraryId={libraryId}
        fileId={file.id}
        filename={file.filename}
        stage="above"
        autoPlay={autoPlay}
        onMini={onMini}
        isMini={isMini}
        onFullscreen={onFullscreen}
        isFullscreen={isFullscreen}
        compact={compact}
      />
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