import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Tooltip
} from '@mantine/core';
import { IconChevronDown, IconInfoCircle, IconX } from '@tabler/icons-react';
import type { FileRecord } from '@shared/types';
import { compareKind, canCompare, type CompareKind } from './compare-kind';
import type { LightingStyle } from '@shared/lighting-types';
import { DEFAULT_HDRI, type HdriId } from '@shared/hdri';
import { DEFAULT_RENDER_QUALITY, type RenderQuality } from '@shared/render-quality';
import {
  MINI_CHROME_TRANSITION,
  PREVIEW_TRANSITION,
  miniChromeTransition,
  pulseResizeBlur
} from '@shared/transition';
import { ModelViewer, type ModelViewerHandle } from '../three/ModelViewer';
import { LIGHTING_PRESETS } from '../three/lighting-presets';
import { HDRI_PRESETS, getHdriPreset } from '../three/hdri-presets';
import { usePreferences, savePreferences } from '../util/use-preferences';
import { GLASS_CLASS, GLASS_TOOLTIP_CLASS } from './glasseffect';
import { AudioPlayer } from './AudioPlayer';
import { AudioVisualizer, createAudioVizStore, type AudioVizStore } from './AudioVisualizer';
import { FileInfoBlock } from './MetadataPanel';
import { TextPreview } from './TextPreview';
import { VideoPlayer } from './VideoPlayer';

type PaneKind = CompareKind;
const paneKind = compareKind;

// Expand / collapse between the preview pane and the full window, with the
// same duration, easing and corner radius as transition.ts.
function previewRect(): DOMRect | null {
  // PreviewPane sets view-transition-name on its container.
  const el = document.querySelector(`[style*="${PREVIEW_TRANSITION.name}"]`);
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? r : null;
}

function insetFrom(r: DOMRect | null): string {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const box = r ?? new DOMRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
  const top = Math.max(0, box.top);
  const left = Math.max(0, box.left);
  const right = Math.max(0, w - box.right);
  const bottom = Math.max(0, h - box.bottom);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${PREVIEW_TRANSITION.radiusPx}px)`;
}

const FULL_INSET = 'inset(0px 0px 0px 0px round 0px)';

interface Props {
  opened: boolean;
  onClose: () => void;
  libraryId: string | null;
  left: FileRecord | null;
  right: FileRecord | null;
  lightingStyle: LightingStyle;
  /**
   * Optional. When given, a view-mode change made here is also reported to the
   * parent so the preview pane stays in sync. When omitted, the modal keeps its
   * own copy of the mode while it is open.
   */
  onLightingStyleChange?: (style: LightingStyle) => void;
}

// Gap around and between the two viewer cards.
const GAP = 10;

// Header is replaced by a slim bar inside the body, and the body fills the
// whole window with flex (no hardcoded pixel offsets, so nothing is cut off at
// the bottom next to the taskbar).
const modalStyles = {
  content: {
    background: 'transparent',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const
  },
  body: {
    flex: 1,
    minHeight: 0,
    maxHeight: 'none',
    padding: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const
  },
  inner: {
    padding: 0
  }
};

/**
 * Side-by-side comparison of exactly two files (any viewer type) with synced cameras. Dragging
 * in either viewer rotates both. Each viewer is its own Three.js scene; we
 * sync via the handle's getCameraState / setCameraState / onCameraChange.
 *
 * View / Environment / Grid are shared by both viewers (same controls and the
 * same saved preferences as the preview pane). The arrows button hides the
 * file name labels and the control panel, like the mini player's hide button.
 */
export function CompareModal({
  opened,
  onClose,
  libraryId,
  left,
  right,
  lightingStyle,
  onLightingStyleChange
}: Props) {
  const leftRef = useRef<ModelViewerHandle>(null);
  const rightRef = useRef<ModelViewerHandle>(null);
  const { prefs } = usePreferences();
  const renderQuality = prefs?.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const hdri: HdriId = prefs?.hdri ?? DEFAULT_HDRI;
  const showGrid = prefs?.showGrid ?? false;

  // Local copy of the view mode so the picker works even when the parent
  // doesn't pass `onLightingStyleChange`. Re-syncs when the modal opens or the
  // parent's value changes.
  const [viewMode, setViewMode] = useState<LightingStyle>(lightingStyle);
  useEffect(() => {
    setViewMode(lightingStyle);
  }, [lightingStyle, opened]);

  const handleViewModeChange = (next: LightingStyle) => {
    setViewMode(next);
    onLightingStyleChange?.(next);
  };

  // HDRI and grid are global preferences, shared with the preview pane. Wait
  // until the prefs have loaded so we never overwrite the file with an empty one.
  const handleHdriChange = (next: HdriId) => {
    if (!prefs) return;
    void savePreferences({ ...prefs, hdri: next });
  };
  const handleGridChange = (on: boolean) => {
    if (!prefs) return;
    void savePreferences({ ...prefs, showGrid: on });
  };

  // Hook up the bidirectional camera sync once both handles are alive.
  useEffect(() => {
    if (!opened) return;
    const L = leftRef.current;
    const R = rightRef.current;
    if (!L || !R) return;
    const offL = L.onCameraChange(() => {
      const state = L.getCameraState();
      if (state) R.setCameraState(state);
    });
    const offR = R.onCameraChange(() => {
      const state = R.getCameraState();
      if (state) L.setCameraState(state);
    });
    return () => {
      offL();
      offR();
    };
  }, [opened, left?.id, right?.id]);

  // Info cards (the same details the metadata panel shows). On by default; the
  // (i) button in the title bar hides / shows all of them.
  const [showInfo, setShowInfo] = useState(true);
  useEffect(() => {
    if (opened) setShowInfo(true);
  }, [opened]);

  // Expand from the preview pane's bounds when opening, shrink back when closing.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const fromRef = useRef<string>(FULL_INSET);

  useEffect(() => {
    if (opened) fromRef.current = insetFrom(previewRect());
  }, [opened]);

  const attachWrap = useCallback((node: HTMLDivElement | null) => {
    wrapRef.current = node;
    if (!node) return;
    closingRef.current = false;
    pulseResizeBlur();
    node.animate(
      [
        { clipPath: fromRef.current, opacity: 0.4 },
        { clipPath: FULL_INSET, opacity: 1 }
      ],
      {
        duration: PREVIEW_TRANSITION.durationMs,
        easing: PREVIEW_TRANSITION.cssEasing,
        fill: 'both'
      }
    );
  }, []);

  const handleClose = useCallback(() => {
    const node = wrapRef.current;
    if (!node || closingRef.current) return;
    closingRef.current = true;
    pulseResizeBlur();
    const anim = node.animate(
      [
        { clipPath: FULL_INSET, opacity: 1 },
        { clipPath: insetFrom(previewRect()), opacity: 0.4 }
      ],
      {
        duration: PREVIEW_TRANSITION.durationMs,
        easing: PREVIEW_TRANSITION.cssEasing,
        fill: 'both'
      }
    );
    const done = () => {
      closingRef.current = false;
      onClose();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }, [onClose]);

  const ready = !!libraryId && !!left && !!right && canCompare([left, right]);
  // The View / Environment / Grid strip only matters when a 3D model is open.
  const hasModel =
    (!!left && paneKind(left) === 'model') || (!!right && paneKind(right) === 'model');

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      styles={modalStyles}
      transitionProps={{ duration: 0 }}
      overlayProps={{ opacity: 0 }}
    >
      <div
        ref={attachWrap}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mantine-color-dark-8)'
        }}
      >
      {/* Slim title bar */}
      <div
        style={{
          flexShrink: 0,
          height: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 14px',
          background: 'var(--mantine-color-dark-8)',
          borderBottom: '1px solid var(--mantine-color-dark-4)'
        }}
      >
        <Text size="xs" fw={600}>
          Compare
        </Text>
        <Group gap={4} wrap="nowrap">
          {ready && (
            <Tooltip label={showInfo ? 'Hide file info' : 'Show file info'} position="bottom" withinPortal>
              <ActionIcon
                variant={showInfo ? 'light' : 'subtle'}
                color={showInfo ? 'indigo' : 'gray'}
                size="sm"
                onClick={() => setShowInfo((v) => !v)}
                aria-label={showInfo ? 'Hide file info' : 'Show file info'}
                aria-pressed={showInfo}
              >
                <IconInfoCircle size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={handleClose}
            aria-label="Close compare"
          >
            <IconX size={15} />
          </ActionIcon>
        </Group>
      </div>

      {!ready ? (
        <Stack align="center" justify="center" style={{ flex: 1 }}>
          <Text c="dimmed">Select exactly two files of the same type to compare.</Text>
        </Stack>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* The two viewer cards */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: GAP }}>
            <div
              style={{
                display: 'flex',
                gap: GAP,
                height: '100%',
                width: '100%',
                minWidth: 0
              }}
            >
              <ComparePane
                ref={leftRef}
                                libraryId={libraryId}
                file={left}
                lightingStyle={viewMode}
                hdri={hdri}
                showGrid={showGrid}
                renderQuality={renderQuality}
                showInfo={showInfo}
              />
              <ComparePane
                ref={rightRef}
                libraryId={libraryId}
                file={right}
                lightingStyle={viewMode}
                hdri={hdri}
                showGrid={showGrid}
                renderQuality={renderQuality}
                showInfo={showInfo}
              />
            </div>
          </div>

          {/* Control panel: collapses by animating its row height to 0 while the
              content slides down and fades. */}
          <div
            style={{
              display: 'grid',
              flexShrink: 0,
              gridTemplateRows: hasModel ? '1fr' : '0fr',
              transition: miniChromeTransition('grid-template-rows')
            }}
          >
            <div
              style={{
                minHeight: 0,
                overflow: 'hidden',
                opacity: hasModel ? 1 : 0,
                transform: !hasModel
                  ? `translateY(${MINI_CHROME_TRANSITION.stripSlidePercent}%)`
                  : 'translateY(0)',
                transition: miniChromeTransition('opacity', 'transform')
              }}
            >
              <div
                style={{
                  padding: '8px 12px',
                  borderTop: '1px solid var(--mantine-color-dark-4)',
                  background: 'var(--mantine-color-dark-7)'
                }}
              >
                <Group gap="md" wrap="wrap">
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
            </div>
          </div>
        </div>
      )}
      </div>
    </Modal>
  );
}

function ComparePane({
  ref,
  libraryId,
  file,
  lightingStyle,
  hdri,
  showGrid,
  renderQuality,
  showInfo
}: {
  /** Points at the inner ModelViewer. */
  ref: Ref<ModelViewerHandle>;
  libraryId: string;
  file: FileRecord;
  lightingStyle: LightingStyle;
  hdri: HdriId;
  showGrid: boolean;
  renderQuality: RenderQuality;
  showInfo: boolean;
}) {
  const kind = paneKind(file);
  // Each pane's player publishes to its own store, so the two visualizers are
  // independent and both can play at once.
  const [vizStore] = useState<AudioVizStore>(() => createAudioVizStore());
  const [infoOpen, setInfoOpen] = useState(true);
  return (
    <div
      data-key-scope
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--wh3d-overlay-border, var(--mantine-color-dark-4))',
        background: 'var(--wh3d-viewport-bg)'
      }}
    >
      {kind === 'video' ? (
        <VideoPlayer
          key={file.id}
          libraryId={libraryId}
          fileId={file.id}
          filename={file.filename}
          ext={file.ext}
        />
      ) : kind === 'audio' ? (
        <Stack h="100%" p="sm" gap="sm" style={{ minHeight: 0 }}>
          <Box style={{ flex: 1, minHeight: 0 }}>
            <AudioVisualizer bars={44} height="100%" store={vizStore} />
          </Box>
          <Box style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            <AudioPlayer
              key={file.id}
              libraryId={libraryId}
              fileId={file.id}
              filename={file.filename}
              showHero={false}
              scopedKeys
              vizStore={vizStore}
            />
          </Box>
        </Stack>
      ) : kind === 'text' ? (
        <TextPreview libraryId={libraryId} file={file} />
      ) : (
        // 3D models and images (the viewer handles pan / zoom for images)
        <ModelViewer
          ref={ref}
          libraryId={libraryId}
          file={file}
          lightingStyle={lightingStyle}
          hdri={hdri}
          showGrid={showGrid}
          renderQuality={renderQuality}
        />
      )}
      {/* File name chip: slides toward the left edge and fades when hidden.
          Text and audio already show the name in their own UI. */}
      {kind !== 'text' && kind !== 'audio' && (
      <div
        className={GLASS_TOOLTIP_CLASS}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          fontFamily: 'var(--mantine-font-family-monospace, monospace)',
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 64px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {file.filename}
      </div>
      )}

      <InfoCard
        libraryId={libraryId}
        file={file}
        kind={kind}
        visible={showInfo}
        open={infoOpen}
        onToggle={() => setInfoOpen((v) => !v)}
      />
    </div>
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

// The card sits in the top-left corner, under the file name chip. Text and audio
// have no chip, so their card starts a little lower to clear the viewer's own
// header buttons.
const INFO_TOP: Record<PaneKind, number> = {
  model: 46,
  image: 46,
  video: 46,
  audio: 54,
  text: 54
};

function InfoCard({
  libraryId,
  file,
  kind,
  visible,
  open,
  onToggle
}: {
  libraryId: string;
  file: FileRecord;
  kind: PaneKind;
  visible: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const top = INFO_TOP[kind];
  return (
    <div
      className={GLASS_CLASS}
      style={{
        position: 'absolute',
        top,
        left: 10,
        zIndex: 5,
        width: open ? 300 : undefined,
        maxWidth: 'calc(100% - 20px)',
        maxHeight: `calc(100% - ${top + 12}px)`,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 16,
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-12px)',
        pointerEvents: visible ? 'auto' : 'none',
        transition: miniChromeTransition('opacity', 'transform')
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse file info' : 'Expand file info'}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '14px 24px 10px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase'
        }}
      >
        <span>Info</span>
        <IconChevronDown
          size={14}
          style={{
            transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: miniChromeTransition('transform')
          }}
        />
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          minHeight: 0,
          transition: miniChromeTransition('grid-template-rows')
        }}
      >
        <div style={{ minHeight: 0, overflow: 'auto' }}>
          <Stack gap={6} style={{ padding: '4px 24px 22px' }}>
            <FileInfoBlock libraryId={libraryId} file={file} />
          </Stack>
        </div>
      </div>
    </div>
  );
}