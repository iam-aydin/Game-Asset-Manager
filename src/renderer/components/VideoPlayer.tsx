import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Collapse,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Popover,
  ScrollArea,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
  UnstyledButton
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronRight,
  IconGauge,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat,
  IconVolume,
  IconVolumeOff,
  IconWand
} from '@tabler/icons-react';
import { PlayerGlassStyles, PLAYER_GLASS_CLASS, PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';

interface VideoPlayerProps {
  libraryId: string;
  fileId: number;
  filename: string;
  /** File extension, used only to give a clearer error for unsupported containers. */
  ext?: string;
  autoPlay?: boolean;
  /** false (default): the control bar sits under the video. true: it floats
   *  over the bottom of the video (the glass then blurs the picture). */
  overlayControls?: boolean;
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

const EQ_MAX_DB = 12;
const EQ_HEADROOM = 0.25;

// Same volume range/snap as AudioPlayer. Above 100% goes through a Web Audio gain node.
const VOLUME_MAX_PCT = 200;
const VOLUME_SNAP_LOW = 94;
const VOLUME_SNAP_HIGH = 125;

// Orange used for "volume boosted above 100%".
const BOOST_COLOR = '#ff922b';
const BOOST_BG = 'rgba(255, 146, 43, 0.18)';

const sliderThumbStyle = {
  backgroundColor: 'var(--wh3d-slider-thumb-bg, #4c6ef5)',
  border: '2px solid var(--wh3d-slider-thumb-border, #000000)'
};

// ---- Menu sizing: menus flex to the room above the control bar --------------
// When the app window (or the floating preview window) is small, a menu taller
// than the space above the control bar would be clipped at the top of the
// window. Each menu measures that space and caps its height; the content then
// scrolls inside a glass scrollbar (GlassScroll). Any menu added later can use
// the same two pieces: useMenuMaxHeight() + <GlassScroll>.

const MENU_OFFSET = 8; // Mantine popover default offset from its target
const MENU_EDGE_MARGIN = 10; // breathing room kept at the top of the window
const MENU_MIN_H = 64;

function useMenuMaxHeight(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  watchRef: React.RefObject<HTMLElement | null>
): number {
  const [maxH, setMaxH] = useState(480);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setMaxH(Math.max(MENU_MIN_H, Math.floor(top - MENU_OFFSET - MENU_EDGE_MARGIN)));
    };
    measure();
    window.addEventListener('resize', measure);
    // Also re-measure when the player itself changes size (floating window resize).
    const ro = new ResizeObserver(measure);
    if (watchRef.current) ro.observe(watchRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [open, anchorRef, watchRef]);
  return maxH;
}

// Thin translucent track + glowing indigo/violet glass thumb.
const glassScrollStyles = {
  scrollbar: {
    background: 'rgba(128, 128, 128, 0.14)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    zIndex: 5
  },
  thumb: {
    background: 'linear-gradient(180deg, rgba(120, 150, 255, 0.75), rgba(150, 110, 250, 0.6))',
    border: '1px solid rgba(255, 255, 255, 0.28)',
    borderRadius: 999,
    boxShadow: '0 0 8px rgba(76, 110, 245, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.35)'
  }
} as const;

/** Scrolls its content only when taller than `maxHeight`. The scrollbar sits in
 *  the menu's own padding (`bleed` px), so nothing shifts when it appears. */
function GlassScroll({
  maxHeight,
  bleed = 7,
  children
}: {
  maxHeight: number;
  bleed?: number;
  children: React.ReactNode;
}) {
  return (
    <ScrollArea.Autosize
      mah={Math.max(48, Math.floor(maxHeight))}
      type="auto"
      scrollbarSize={5}
      scrollHideDelay={600}
      styles={glassScrollStyles}
      style={{ marginRight: -bleed }}
    >
      <div style={{ paddingRight: bleed }}>{children}</div>
    </ScrollArea.Autosize>
  );
}

// ---- Glass segmented control (Fit / Stretch / Actual / Custom, Rotate) -------
// Translucent track + a glowing glass "pill" for the active option, so it
// matches the player's glass look in both dark and light themes.

const glassSegmentedStyles = {
  root: {
    background: 'rgba(128, 128, 128, 0.14)',
    border: '1px solid rgba(255, 255, 255, 0.10)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 10,
    padding: 3,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)'
  },
  indicator: {
    background:
      'linear-gradient(135deg, rgba(92, 124, 250, 0.55), rgba(132, 94, 247, 0.45))',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: 8,
    boxShadow: '0 2px 10px rgba(76, 110, 245, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)'
  },
  control: {
    border: 'none'
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 6px',
    cursor: 'pointer',
    transition: 'color 160ms ease'
  }
} as const;

function GlassSegmented({
  value,
  onChange,
  data
}: {
  value: string;
  onChange: (v: string) => void;
  data: { value: string; label: string }[];
}) {
  return (
    <SegmentedControl
      size="xs"
      fullWidth
      radius="md"
      transitionDuration={180}
      value={value}
      onChange={onChange}
      data={data}
      styles={glassSegmentedStyles}
    />
  );
}

// ---- Scale & position model ------------------------------------------------
// fit     = whole video visible (letterboxed)
// stretch = video stretched to fill the player (ignores aspect ratio)
// actual  = native pixel size (1:1), centered, clipped if bigger than the player
// custom  = fit + user zoom / stretch / pan (sliders, keys, mouse)

type ScaleMode = 'fit' | 'stretch' | 'actual' | 'custom';

interface VideoZoom {
  mode: ScaleMode;
  zoom: number; // 1 = 100%
  panX: number; // % of the player width
  panY: number; // % of the player height
  stretchX: number; // horizontal stretch multiplier
  stretchY: number; // vertical stretch multiplier
}

const DEFAULT_VZ: VideoZoom = {
  mode: 'fit',
  zoom: 1,
  panX: 0,
  panY: 0,
  stretchX: 1,
  stretchY: 1
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 10;
const ZOOM_STEP = 0.1; // - / + keys
const STRETCH_MIN = 0.25;
const STRETCH_MAX = 3;
const STRETCH_STEP = 0.05; // [ and ] keys
const PAN_STEP = 3; // % per Shift+W/A/S/D press

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

// How far the picture can be moved: enough to bring any edge to the opposite
// side of the player, and it grows with zoom/stretch.
const panLimit = (zoom: number, stretch: number) => Math.ceil(50 * (zoom * stretch + 1));

const normalizeVz = (v: VideoZoom): VideoZoom => {
  const lx = panLimit(v.zoom, v.stretchX);
  const ly = panLimit(v.zoom, v.stretchY);
  return {
    ...v,
    zoom: clampNum(round3(v.zoom), ZOOM_MIN, ZOOM_MAX),
    stretchX: clampNum(round3(v.stretchX), STRETCH_MIN, STRETCH_MAX),
    stretchY: clampNum(round3(v.stretchY), STRETCH_MIN, STRETCH_MAX),
    panX: round2(clampNum(v.panX, -lx, lx)),
    panY: round2(clampNum(v.panY, -ly, ly))
  };
};

// Any zoom/pan/stretch input switches to Custom (keeping earlier custom values).
const toCustom = (v: VideoZoom): VideoZoom => (v.mode === 'custom' ? v : { ...v, mode: 'custom' });

const isDefaultVz = (v: VideoZoom) =>
  v.mode === 'fit' &&
  v.zoom === 1 &&
  v.panX === 0 &&
  v.panY === 0 &&
  v.stretchX === 1 &&
  v.stretchY === 1;

// ---- Effects model --------------------------------------------------------

interface VideoFx {
  brightness: number; // %, 100 = unchanged
  contrast: number; // %
  saturation: number; // %
  hue: number; // degrees
  flip: boolean; // mirror horizontally
  flipV: boolean; // mirror vertically
  rotate: number; // 0 | 90 | 180 | 270 degrees (clockwise)
}

// Same set of audio effects as AudioPlayer (EQ, pitch, reverb).
interface AudioFx {
  pitch: number; // semitones
  reverbWet: number; // 0..1
  subBass: number; // dB
  bass: number; // dB
  treble: number; // dB
}

const DEFAULT_VIDEO_FX: VideoFx = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  flip: false,
  flipV: false,
  rotate: 0
};

const DEFAULT_AUDIO_FX: AudioFx = {
  pitch: 0,
  reverbWet: 0,
  subBass: 0,
  bass: 0,
  treble: 0
};

// ---- Persisted prefs (same pattern as the audio player's effects store) ----
// Mute is intentionally NOT persisted: nobody wants a video to silently open muted.
// Scale/zoom/pan is intentionally NOT persisted either: every video opens at "Fit".

type PersistedVideoPrefs = {
  speed: number;
  volume: number; // 0..2 (anything above 1 uses the Web Audio boost gain)
  isLooping: boolean;
} & VideoFx &
  AudioFx;

const DEFAULT_VIDEO_PREFS: PersistedVideoPrefs = {
  speed: 1,
  volume: 1,
  isLooping: false,
  ...DEFAULT_VIDEO_FX,
  ...DEFAULT_AUDIO_FX
};

const STORAGE_KEY = 'wh3d_video_player_prefs';

const loadPrefs = (): PersistedVideoPrefs => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_VIDEO_PREFS, ...JSON.parse(saved) };
  } catch (e) {
    console.error('Failed to load video prefs from localStorage:', e);
  }
  return { ...DEFAULT_VIDEO_PREFS };
};

let persistedPrefs: PersistedVideoPrefs = loadPrefs();

const videoPrefsStore = {
  get: (): PersistedVideoPrefs => persistedPrefs,
  set(partial: Partial<PersistedVideoPrefs>) {
    persistedPrefs = { ...persistedPrefs, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedPrefs));
    } catch (e) {
      console.error('Failed to save video prefs to localStorage:', e);
    }
  },
  reset(): PersistedVideoPrefs {
    persistedPrefs = { ...DEFAULT_VIDEO_PREFS };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedPrefs));
    } catch (e) {
      console.error('Failed to reset video prefs in localStorage:', e);
    }
    return persistedPrefs;
  }
};

// ---- Web Audio (only created once an audio effect is actually used) --------

let sharedAudioCtx: AudioContext | null = null;

const getSharedAudioContext = (): AudioContext => {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioCtx = new AudioCtxClass();
  }
  return sharedAudioCtx;
};

const createImpulseResponse = (ctx: AudioContext, durationSec = 2.5, decay = 2.5) => {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
};

interface VideoAudioGraph {
  ctx: AudioContext;
  video: HTMLVideoElement;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  sub: BiquadFilterNode;
  bass: BiquadFilterNode;
  treble: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
}

// createMediaElementSource() may only be called ONCE per <video>. Calling it again
// (React StrictMode double effects, remounts) throws, and a disconnected source
// leaves the element silent/stalled. So the graph is cached per element and reused.
const graphCache = new WeakMap<HTMLVideoElement, VideoAudioGraph>();

/** Same chain as AudioPlayer: preamp -> sub shelf -> bass peak -> treble shelf
 *  -> dry/reverb mix -> limiter. Volume stays on the <video> element. */
const buildVideoAudioGraph = (video: HTMLVideoElement): VideoAudioGraph => {
  const cached = graphCache.get(video);
  if (cached) return cached;
  const ctx = getSharedAudioContext();
  const source = ctx.createMediaElementSource(video);

  const preamp = ctx.createGain();

  const sub = ctx.createBiquadFilter();
  sub.type = 'lowshelf';
  sub.frequency.value = 60;

  const bass = ctx.createBiquadFilter();
  bass.type = 'peaking';
  bass.frequency.value = 150;
  bass.Q.value = 0.9;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 6000;

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulseResponse(ctx);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  source.connect(preamp);
  preamp.connect(sub);
  sub.connect(bass);
  bass.connect(treble);
  treble.connect(dry);
  const boost = ctx.createGain(); // volume above 100%
  boost.connect(limiter);
  dry.connect(boost);
  treble.connect(convolver);
  convolver.connect(wet);
  wet.connect(boost);

  const graph: VideoAudioGraph = {
    ctx,
    video,
    source,
    preamp,
    sub,
    bass,
    treble,
    dry,
    wet,
    boost,
    limiter
  };
  graphCache.set(video, graph);
  return graph;
};

const applyAudioFx = (g: VideoAudioGraph, fx: AudioFx, volume: number) => {
  const t = g.ctx.currentTime;
  g.dry.gain.setTargetAtTime(1 - fx.reverbWet, t, 0.01);
  g.wet.gain.setTargetAtTime(fx.reverbWet, t, 0.01);
  g.sub.gain.setTargetAtTime(fx.subBass, t, 0.02);
  g.bass.gain.setTargetAtTime(fx.bass, t, 0.02);
  g.treble.gain.setTargetAtTime(fx.treble, t, 0.02);
  g.boost.gain.setTargetAtTime(Math.max(1, volume), t, 0.02);
  const maxBoost = Math.max(0, fx.subBass, fx.bass, fx.treble);
  g.preamp.gain.setTargetAtTime(Math.pow(10, -(maxBoost * EQ_HEADROOM) / 20), t, 0.02);
};

/** Pitch is applied like AudioPlayer: semitones multiply the playback rate. */
const effectiveRate = (speed: number, pitchSemitones: number) =>
  Math.max(0.0625, Math.min(16, speed * Math.pow(2, pitchSemitones / 12)));

const formatTime = (timeSec: number) => {
  if (!Number.isFinite(timeSec) || timeSec < 0) return '0:00';
  const hrs = Math.floor(timeSec / 3600);
  const mins = Math.floor((timeSec % 3600) / 60);
  const secs = Math.floor(timeSec % 60);
  const ss = secs < 10 ? `0${secs}` : `${secs}`;
  if (hrs > 0) return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${ss}`;
  return `${mins}:${ss}`;
};

const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

// ---- Small UI pieces for the Effects popover -------------------------------

function EffectSection({
  title,
  open,
  onToggle,
  active,
  onReset,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  active: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="gam-fx-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <UnstyledButton
          onClick={onToggle}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 8px'
          }}
        >
          <IconChevronRight
            size={12}
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 160ms ease',
              flexShrink: 0
            }}
          />
          <Text size="xs" fw={600} style={{ flex: 1 }}>
            {title}
          </Text>
          {active && (
            <Badge size="xs" variant="light" color="indigo">
              On
            </Badge>
          )}
        </UnstyledButton>
        <UnstyledButton onClick={onReset} disabled={!active} style={{ paddingRight: 8 }}>
          <Text size="xs" c={active ? 'indigo' : 'dimmed'}>
            Reset
          </Text>
        </UnstyledButton>
      </div>
      <Collapse in={open} transitionDuration={180}>
        <Stack gap="xs" style={{ padding: '4px 8px 8px 18px' }}>
          {children}
        </Stack>
      </Collapse>
    </div>
  );
}

function FxSlider({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
  color = 'indigo',
  marks
}: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color?: string;
  marks?: { value: number }[];
}) {
  // Hover + scroll adjusts just this slider, same as the audio player.
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
    if (dir === 0) return;
    const next = Math.round((value + dir * step) * 100) / 100;
    onChange(Math.max(min, Math.min(max, next)));
  };
  return (
    <div onWheel={onWheel}>
      <Group justify="space-between" mb={2} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" style={{ fontFamily: 'monospace' }}>
          {display}
        </Text>
      </Group>
      <Slider
        size="xs"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        label={() => display}
        marks={marks}
        color={color}
        styles={{ thumb: sliderThumbStyle }}
      />
    </div>
  );
}

export function VideoPlayer({
  libraryId,
  fileId,
  filename,
  ext,
  autoPlay = false,
  overlayControls = false
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  const graphRef = useRef<VideoAudioGraph | null>(null);
  const resetOpenRef = useRef(false);

  // Anchors used to measure how much room each menu has above the control bar.
  const effectsBtnRef = useRef<HTMLButtonElement | null>(null);
  const speedBtnRef = useRef<HTMLButtonElement | null>(null);
  const volumeAnchorRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(() => videoPrefsStore.get().volume);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(() => videoPrefsStore.get().speed);
  const [isLooping, setIsLooping] = useState(() => videoPrefsStore.get().isLooping);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  resetOpenRef.current = confirmResetOpen;

  // Sizes used to keep a rotated (90/270) picture inside the player.
  const [surfaceSize, setSurfaceSize] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  // Effects popover
  const [fxOpen, setFxOpen] = useState(false);
  const [videoSectionOpen, setVideoSectionOpen] = useState(false);
  const [scaleSectionOpen, setScaleSectionOpen] = useState(false);
  const [audioSectionOpen, setAudioSectionOpen] = useState(false);
  const [vfx, setVfx] = useState<VideoFx>(() => {
    const p = videoPrefsStore.get();
    return {
      brightness: p.brightness,
      contrast: p.contrast,
      saturation: p.saturation,
      hue: p.hue,
      flip: p.flip,
      flipV: p.flipV,
      rotate: p.rotate
    };
  });
  const [afx, setAfx] = useState<AudioFx>(() => {
    const p = videoPrefsStore.get();
    return {
      pitch: p.pitch,
      reverbWet: p.reverbWet,
      subBass: p.subBass,
      bass: p.bass,
      treble: p.treble
    };
  });

  // Room above each menu's button (updates live while the menu is open).
  const fxMaxH = useMenuMaxHeight(fxOpen, effectsBtnRef, wrapperRef);
  const speedMaxH = useMenuMaxHeight(speedOpen, speedBtnRef, wrapperRef);
  const volumeMaxH = useMenuMaxHeight(volumeOpen, volumeAnchorRef, wrapperRef);

  // Scale / zoom / pan / stretch. Session-only; each video opens at Fit.
  const [vz, setVz] = useState<VideoZoom>(DEFAULT_VZ);

  // All vz changes go through here so pan/zoom/stretch stay inside their limits.
  const updateVz = useCallback((fn: (prev: VideoZoom) => VideoZoom) => {
    setVz((prev) => normalizeVz(fn(prev)));
  }, []);

  const zoomBy = useCallback(
    (delta: number) => updateVz((p) => ({ ...toCustom(p), zoom: toCustom(p).zoom + delta })),
    [updateVz]
  );

  const panBy = useCallback(
    (dxPct: number, dyPct: number) =>
      updateVz((p) => {
        const b = toCustom(p);
        return { ...b, panX: b.panX + dxPct, panY: b.panY + dyPct };
      }),
    [updateVz]
  );

  const stretchBy = useCallback(
    (axis: 'x' | 'y', delta: number) =>
      updateVz((p) => {
        const b = toCustom(p);
        return axis === 'x'
          ? { ...b, stretchX: b.stretchX + delta }
          : { ...b, stretchY: b.stretchY + delta };
      }),
    [updateVz]
  );

  const scaleActive = !isDefaultVz(vz);

  const vfxActive =
    vfx.brightness !== 100 ||
    vfx.contrast !== 100 ||
    vfx.saturation !== 100 ||
    vfx.hue !== 0 ||
    vfx.flip ||
    vfx.flipV ||
    vfx.rotate !== 0;
  const afxActive =
    afx.pitch !== 0 ||
    afx.reverbWet !== 0 ||
    afx.subBass !== 0 ||
    afx.bass !== 0 ||
    afx.treble !== 0;
  const fxActive = vfxActive || afxActive || scaleActive;

  const hasCssFilter =
    vfx.brightness !== 100 || vfx.contrast !== 100 || vfx.saturation !== 100 || vfx.hue !== 0;
  const videoFilter = hasCssFilter
    ? `brightness(${vfx.brightness}%) contrast(${vfx.contrast}%) saturate(${vfx.saturation}%) hue-rotate(${vfx.hue}deg)`
    : undefined;

  // Scale mode -> how the picture is drawn. Zoom/pan/stretch only apply in Custom.
  const videoObjectFit: 'contain' | 'fill' | 'none' =
    vz.mode === 'stretch' ? 'fill' : vz.mode === 'actual' ? 'none' : 'contain';

  // A picture rotated by 90/270 degrees is sideways, so it has to be scaled
  // down (or up) to still fit inside the player.
  const rotateFit = (() => {
    if (vfx.rotate % 180 === 0) return 1;
    const { w: W, h: H } = surfaceSize;
    if (!W || !H) return 1;
    if (vz.mode === 'stretch') return Math.min(W / H, H / W);
    if (vz.mode === 'actual') return 1;
    const { w: vw, h: vh } = videoSize;
    if (!vw || !vh) return 1;
    const fit = Math.min(W / vw, H / vh);
    const dw = vw * fit;
    const dh = vh * fit;
    return Math.min(W / dh, H / dw);
  })();

  // Transform order (outermost first): move -> zoom/stretch + mirror -> rotate.
  // Mirror and zoom happen on screen axes, so "mirror horizontally" always
  // flips left/right as you see it, even after rotating.
  const scaleX = (vz.mode === 'custom' ? vz.zoom * vz.stretchX : 1) * (vfx.flip ? -1 : 1);
  const scaleY = (vz.mode === 'custom' ? vz.zoom * vz.stretchY : 1) * (vfx.flipV ? -1 : 1);
  const transformParts: string[] = [];
  if (vz.mode === 'custom') transformParts.push(`translate(${vz.panX}%, ${vz.panY}%)`);
  if (scaleX !== 1 || scaleY !== 1) transformParts.push(`scale(${scaleX}, ${scaleY})`);
  if (vfx.rotate !== 0) {
    transformParts.push(`scale(${round3(rotateFit)}) rotate(${vfx.rotate}deg)`);
  }
  const videoTransform = transformParts.length > 0 ? transformParts.join(' ') : undefined;

  const src = `wh3d-file://${libraryId}/${fileId}`;

  // Only the wrapper goes fullscreen, and Mantine portals render on document.body,
  // which sits behind the fullscreen layer. While fullscreen, portal into the
  // wrapper instead so menus/tooltips show over the video.
  const portalProps =
    isFullscreen && wrapperRef.current ? { target: wrapperRef.current } : undefined;

  // Menus stay on top of their button and never flip below it: their height is
  // capped to the room above instead (see useMenuMaxHeight / GlassScroll).
  const menuMiddlewares = { flip: false, shift: true } as const;

  // Track the player size (needed for the rotate fit above).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const update = () => setSurfaceSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Sync React state -> <video> element ----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, volume));
    v.muted = isMuted;
    videoPrefsStore.set({ volume });
  }, [volume, isMuted]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const rate = effectiveRate(speed, afx.pitch);
    // With a pitch shift we want the pitch to follow the rate; otherwise keep
    // the browser's default (speed changes without changing pitch).
    v.preservesPitch = afx.pitch === 0;
    // defaultPlaybackRate survives the load algorithm; playbackRate alone is reset by it.
    v.defaultPlaybackRate = rate;
    v.playbackRate = rate;
    videoPrefsStore.set({ speed });
  }, [speed, afx.pitch]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.loop = isLooping;
    videoPrefsStore.set({ isLooping });
  }, [isLooping]);

  useEffect(() => {
    videoPrefsStore.set(vfx);
  }, [vfx]);

  useEffect(() => {
    videoPrefsStore.set(afx);
  }, [afx]);

  // The Web Audio graph is only built once an audio effect is on or volume is
  // boosted above 100%, so plain playback never goes through it.
  useEffect(() => {
    if (!afxActive && volume <= 1 && !graphRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    if (!graphRef.current) {
      try {
        graphRef.current = buildVideoAudioGraph(v);
      } catch (e) {
        console.error('[VideoPlayer] could not start the audio effects engine', e);
        return;
      }
    }
    applyAudioFx(graphRef.current, afx, volume);
    if (graphRef.current.ctx.state === 'suspended') {
      void graphRef.current.ctx.resume().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afx, volume]);

  useEffect(() => {
    return () => {
      const g = graphRef.current;
      graphRef.current = null;
      if (!g) return;
      // Dev/StrictMode runs this cleanup while the element is still mounted.
      // Tearing the graph down then would orphan the element's audio, so only
      // disconnect when the <video> has really left the DOM.
      if (g.video.isConnected) return;
      try {
        g.source.disconnect();
      } catch {}
      try {
        g.limiter.disconnect();
      } catch {}
      graphCache.delete(g.video);
    };
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
      // Close open menus on toggle so none are left floating in the wrong layer.
      setFxOpen(false);
      setVolumeOpen(false);
      setSpeedOpen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Shift + scroll wheel zooms toward the mouse pointer (the point under the
  // cursor stays put). Native listener so preventDefault works (React's wheel
  // handlers are passive).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      // Chromium turns Shift+wheel into horizontal scroll (deltaX) on Windows.
      const d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (d === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Pointer position relative to the player center (the transform origin).
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const factor = Math.exp(-d * 0.002);
      updateVz((prev) => {
        const b = toCustom(prev);
        const newZoom = clampNum(round3(b.zoom * factor), ZOOM_MIN, ZOOM_MAX);
        const ratio = newZoom / b.zoom;
        const txPx = (b.panX / 100) * rect.width;
        const tyPx = (b.panY / 100) * rect.height;
        const ntx = cx - (cx - txPx) * ratio;
        const nty = cy - (cy - tyPx) * ratio;
        return {
          ...b,
          zoom: newZoom,
          panX: (ntx / rect.width) * 100,
          panY: (nty / rect.height) * 100
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [updateVz]);

  // Right mouse button held + drag moves the picture.
  const handleSurfaceMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 2) return;
    const el = surfaceRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let lastX = e.clientX;
    let lastY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - lastX) / rect.width) * 100;
      const dy = ((ev.clientY - lastY) / rect.height) * 100;
      lastX = ev.clientX;
      lastY = ev.clientY;
      panBy(dx, dy);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ---- Actions ----
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || error) return;
    if (graphRef.current?.ctx.state === 'suspended') {
      void graphRef.current.ctx.resume().catch(() => undefined);
    }
    if (v.paused || v.ended) void v.play().catch(() => undefined);
    else v.pause();
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const total = Number.isFinite(v.duration) ? v.duration : 0;
    const clamped = Math.max(0, Math.min(total || t, t));
    v.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const seekRelative = (direction: -1 | 1) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const step = v.duration < 5 ? 1 : 5;
    seekTo(v.currentTime + direction * step);
  };

  const adjustVolumeRelative = (deltaPct: number) => {
    setIsMuted(false);
    setVolume((prev) => {
      const pct = Math.max(0, Math.min(VOLUME_MAX_PCT, Math.round(prev * 100) + deltaPct));
      return pct / 100;
    });
  };

  const changeSpeedStep = (direction: 'down' | 'up' | 'reset') => {
    if (direction === 'reset') {
      setSpeed(1);
      return;
    }
    let closestIdx = 0;
    let minDiff = Infinity;
    SPEED_PRESETS.forEach((s, idx) => {
      const diff = Math.abs(s - speed);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    const nextIdx =
      direction === 'down'
        ? Math.max(0, closestIdx - 1)
        : Math.min(SPEED_PRESETS.length - 1, closestIdx + 1);
    setSpeed(SPEED_PRESETS[nextIdx]);
  };

  const toggleMute = () => setIsMuted((prev) => !prev);

  const handleVolumeChange = (pct: number) => {
    setIsMuted(false);
    const locked = pct >= VOLUME_SNAP_LOW && pct <= VOLUME_SNAP_HIGH ? 100 : pct;
    setVolume(locked / 100);
  };

  // A media element routed through a suspended AudioContext stalls, so make
  // sure the context is running before any play().
  const resumeGraph = () => {
    const ctx = graphRef.current?.ctx;
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  };

  // Reset everything (speed, volume, loop, mute, scale, video + audio effects) to defaults.
  const confirmResetEffects = () => {
    const d = videoPrefsStore.reset();
    setSpeed(d.speed);
    setVolume(d.volume);
    setIsMuted(false);
    setIsLooping(d.isLooping);
    setVfx({ ...DEFAULT_VIDEO_FX });
    setAfx({ ...DEFAULT_AUDIO_FX });
    setVz({ ...DEFAULT_VZ });
    setConfirmResetOpen(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      setConfirmResetOpen(true);
    }
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => undefined);
  };

  // Windows-style hover-to-scroll, same helper shape as AudioPlayer.
  const onWheelAdjust = (adjust: (dir: 1 | -1) => void) => (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) adjust(1);
    else if (e.deltaY > 0) adjust(-1);
  };

  // ---- Keyboard (same keymap as AudioPlayer, plus F for fullscreen) ----
  const actionsRef = useRef({
    togglePlay,
    seekRelative,
    adjustVolumeRelative,
    changeSpeedStep,
    toggleMute,
    toggleFullscreen
  });
  useEffect(() => {
    actionsRef.current = {
      togglePlay,
      seekRelative,
      adjustVolumeRelative,
      changeSpeedStep,
      toggleMute,
      toggleFullscreen
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target && (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (resetOpenRef.current) return;

      const a = actionsRef.current;
      const key = e.key.toLowerCase();

      // --- Scale / position keys. These are handled FIRST and always return, so
      // a Shift combo never falls through to the plain-key action below
      // (Shift+W pans; it does NOT raise the volume, Shift+S does NOT play/pause...).
      if (e.shiftKey && (key === 'w' || key === 'a' || key === 's' || key === 'd')) {
        e.preventDefault();
        e.stopPropagation();
        if (key === 'w') panBy(0, -PAN_STEP);
        else if (key === 's') panBy(0, PAN_STEP);
        else if (key === 'a') panBy(-PAN_STEP, 0);
        else panBy(PAN_STEP, 0);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
        return;
      }
      // [ = stretch vertically, ] = stretch horizontally. Add Shift to shrink.
      if (e.code === 'BracketLeft') {
        e.preventDefault();
        stretchBy('y', e.shiftKey ? -STRETCH_STEP : STRETCH_STEP);
        return;
      }
      if (e.code === 'BracketRight') {
        e.preventDefault();
        stretchBy('x', e.shiftKey ? -STRETCH_STEP : STRETCH_STEP);
        return;
      }

      // Any other Shift combo does nothing here.
      if (e.shiftKey) return;

      if (e.code === 'Space' || key === 's') {
        e.preventDefault();
        e.stopPropagation();
        a.togglePlay();
      } else if (key === 'a') {
        e.preventDefault();
        a.seekRelative(-1);
      } else if (key === 'd') {
        e.preventDefault();
        a.seekRelative(1);
      } else if (key === 'w') {
        e.preventDefault();
        a.adjustVolumeRelative(5);
      } else if (key === 'x') {
        e.preventDefault();
        a.adjustVolumeRelative(-5);
      } else if (key === 'm') {
        e.preventDefault();
        a.toggleMute();
      } else if (key === 'j') {
        e.preventDefault();
        a.changeSpeedStep('down');
      } else if (key === 'l') {
        e.preventDefault();
        a.changeSpeedStep('up');
      } else if (key === 'k') {
        e.preventDefault();
        a.changeSpeedStep('reset');
      } else if (key === 'f') {
        e.preventDefault();
        a.toggleFullscreen();
      } else if (key === 'r') {
        e.preventDefault();
        setConfirmResetOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [panBy, zoomBy, stretchBy]);

  // ---- <video> event handlers ----
  const handleError = () => {
    const code = videoRef.current?.error?.code;
    setErrorDetail(videoRef.current?.error?.message || null);
    console.error('[VideoPlayer] playback error', videoRef.current?.error);
    const lower = (ext ?? '').replace(/^\./, '').toLowerCase();
    // 4 === MEDIA_ERR_SRC_NOT_SUPPORTED
    if (lower === 'avi') {
      setError('AVI isn’t supported by the built-in player yet.');
    } else if (code === 4) {
      setError('This file’s codec isn’t supported by the built-in player.');
    } else {
      setError('This video couldn’t be played.');
    }
    setIsBuffering(false);
    setIsPlaying(false);
  };

  const volumePct = Math.round((isMuted ? 0 : volume) * 100);
  const muted = isMuted || volume === 0;
  const boosted = !isMuted && volume > 1;

  const setV = (partial: Partial<VideoFx>) => setVfx((prev) => ({ ...prev, ...partial }));
  const setA = (partial: Partial<AudioFx>) => setAfx((prev) => ({ ...prev, ...partial }));

  const panLimX = panLimit(vz.zoom, vz.stretchX);
  const panLimY = panLimit(vz.zoom, vz.stretchY);

  const controlBar = (
    <Box
      p="xs"
      style={
        overlayControls
          ? { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 }
          : { flexShrink: 0 }
      }
    >
      <Card
        withBorder={false}
        radius="lg"
        p="xs"
        className={PLAYER_GLASS_CLASS}
        style={{ width: '100%' }}
      >
        <Group wrap="nowrap" gap="md" align="center">
          <ActionIcon
            variant="filled"
            color="indigo"
            radius="xl"
            size={42}
            onClick={togglePlay}
            disabled={!!error}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{ flexShrink: 0 }}
          >
            {isPlaying ? (
              <IconPlayerPause size={20} />
            ) : (
              <IconPlayerPlay size={20} style={{ marginLeft: 2 }} />
            )}
          </ActionIcon>

          <Box style={{ flexShrink: 1, flexGrow: 0, minWidth: 0, maxWidth: 180, overflow: 'hidden' }}>
            <Text size="xs" fw={700} truncate>
              {filename}
            </Text>
            <Text size="10px" c="dimmed" style={{ fontFamily: 'monospace' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </Box>

          {/* Seek bar */}
          <Box style={{ flex: '1 1 140px', minWidth: 140, display: 'flex', alignItems: 'center' }}>
            <Slider
              size="sm"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={(val) => {
                scrubbingRef.current = true;
                seekTo(val);
              }}
              onChangeEnd={() => {
                scrubbingRef.current = false;
              }}
              disabled={!!error || duration === 0}
              label={formatTime}
              color="indigo"
              style={{ width: '100%' }}
              styles={{ thumb: sliderThumbStyle }}
            />
          </Box>

          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {/* Loop — hover + scroll: up turns it on, down turns it off */}
            <Tooltip
              label={isLooping ? 'Loop: On (scroll to toggle)' : 'Loop: Off (scroll to toggle)'}
              withinPortal
              portalProps={portalProps}
            >
              <ActionIcon
                variant={isLooping ? 'filled' : 'subtle'}
                color={isLooping ? 'indigo' : 'gray'}
                size="md"
                onClick={() => setIsLooping(!isLooping)}
                onWheel={onWheelAdjust((dir) => setIsLooping(dir === 1))}
                aria-label="Toggle loop"
              >
                <IconRepeat size={16} />
              </ActionIcon>
            </Tooltip>

            {/* Speed — hover + scroll steps through presets */}
            <Menu
              shadow="md"
              width={100}
              position="top"
              portalProps={portalProps}
              opened={speedOpen}
              onChange={setSpeedOpen}
              middlewares={menuMiddlewares}
            >
              <Menu.Target>
                <Tooltip
                  label={`Speed: ${speed}x (J/K/L, or scroll)`}
                  withinPortal
                  portalProps={portalProps}
                >
                  <ActionIcon
                    ref={speedBtnRef}
                    variant={speed !== 1 ? 'filled' : 'subtle'}
                    color={speed !== 1 ? 'indigo' : 'gray'}
                    size="md"
                    aria-label="Playback speed"
                    onWheel={onWheelAdjust((dir) => changeSpeedStep(dir === 1 ? 'up' : 'down'))}
                  >
                    <IconGauge size={16} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <GlassScroll maxHeight={speedMaxH - 12} bleed={3}>
                  {SPEED_PRESETS.map((s) => {
                    const isSelected = speed === s;
                    return (
                      <Menu.Item
                        key={s}
                        onClick={() => setSpeed(s)}
                        disabled={isSelected}
                        style={{
                          opacity: isSelected ? 0.45 : 1,
                          backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.08)' : undefined,
                          cursor: isSelected ? 'default' : 'pointer'
                        }}
                      >
                        <Text size="xs" fw={isSelected ? 700 : 500}>
                          {s}x
                        </Text>
                      </Menu.Item>
                    );
                  })}
                </GlassScroll>
              </Menu.Dropdown>
            </Menu>

            {/* Effects — collapsible categories, like the Filter menu */}
            <Popover
              width={280}
              position="top"
              shadow="md"
              withArrow={false}
              opened={fxOpen}
              onChange={setFxOpen}
              portalProps={portalProps}
              middlewares={menuMiddlewares}
              classNames={{ dropdown: PLAYER_GLASS_POPOVER_CLASS }}
            >
              <Popover.Target>
                <Tooltip label="Effects" withinPortal portalProps={portalProps}>
                  <ActionIcon
                    ref={effectsBtnRef}
                    variant={fxActive ? 'filled' : 'subtle'}
                    color={fxActive ? 'violet' : 'gray'}
                    size="md"
                    aria-label="Effects"
                    onClick={() => setFxOpen((o) => !o)}
                  >
                    <IconWand size={16} />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown style={{ padding: '8px 10px' }}>
                <GlassScroll maxHeight={fxMaxH - 20}>
                  <EffectSection
                    title="Video Effects"
                    open={videoSectionOpen}
                    onToggle={() => setVideoSectionOpen((o) => !o)}
                    active={vfxActive}
                    onReset={() => setVfx({ ...DEFAULT_VIDEO_FX })}
                  >
                    <FxSlider
                      label="Brightness"
                      display={`${vfx.brightness}%`}
                      value={vfx.brightness}
                      min={50}
                      max={150}
                      step={1}
                      onChange={(v) => setV({ brightness: v })}
                      marks={[{ value: 100 }]}
                    />
                    <FxSlider
                      label="Contrast"
                      display={`${vfx.contrast}%`}
                      value={vfx.contrast}
                      min={50}
                      max={150}
                      step={1}
                      onChange={(v) => setV({ contrast: v })}
                      marks={[{ value: 100 }]}
                    />
                    <FxSlider
                      label="Saturation"
                      display={`${vfx.saturation}%`}
                      value={vfx.saturation}
                      min={0}
                      max={200}
                      step={1}
                      onChange={(v) => setV({ saturation: v })}
                      marks={[{ value: 100 }]}
                    />
                    <FxSlider
                      label="Hue"
                      display={`${vfx.hue > 0 ? '+' : ''}${vfx.hue}°`}
                      value={vfx.hue}
                      min={-180}
                      max={180}
                      step={1}
                      onChange={(v) => setV({ hue: v })}
                      marks={[{ value: 0 }]}
                    />

                    <div>
                      <Group justify="space-between" mb={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          Rotate
                        </Text>
                        <Text size="xs" style={{ fontFamily: 'monospace' }}>
                          {vfx.rotate}°
                        </Text>
                      </Group>
                      <GlassSegmented
                        value={String(vfx.rotate)}
                        onChange={(v) => setV({ rotate: Number(v) })}
                        data={[
                          { value: '0', label: '0°' },
                          { value: '90', label: '90°' },
                          { value: '180', label: '180°' },
                          { value: '270', label: '270°' }
                        ]}
                      />
                    </div>

                    <Switch
                      size="xs"
                      label="Mirror horizontally"
                      checked={vfx.flip}
                      onChange={(e) => setV({ flip: e.currentTarget.checked })}
                    />
                    <Switch
                      size="xs"
                      label="Mirror vertically"
                      checked={vfx.flipV}
                      onChange={(e) => setV({ flipV: e.currentTarget.checked })}
                    />
                  </EffectSection>

                  <Divider my={4} />

                  <EffectSection
                    title="Scale & Position"
                    open={scaleSectionOpen}
                    onToggle={() => setScaleSectionOpen((o) => !o)}
                    active={scaleActive}
                    onReset={() => setVz({ ...DEFAULT_VZ })}
                  >
                    <GlassSegmented
                      value={vz.mode}
                      onChange={(v) => updateVz((p) => ({ ...p, mode: v as ScaleMode }))}
                      data={[
                        { value: 'fit', label: 'Fit' },
                        { value: 'stretch', label: 'Stretch' },
                        { value: 'actual', label: 'Actual' },
                        { value: 'custom', label: 'Custom' }
                      ]}
                    />
                    {vz.mode === 'custom' && (
                      <>
                        <FxSlider
                          label="Scale"
                          display={`${+vz.zoom.toFixed(2)}x`}
                          value={vz.zoom}
                          min={ZOOM_MIN}
                          max={ZOOM_MAX}
                          step={0.1}
                          onChange={(v) => updateVz((p) => ({ ...p, zoom: v }))}
                          marks={[{ value: 1 }]}
                        />
                        <FxSlider
                          label="X (move left / right)"
                          display={`${Math.round(vz.panX)}%`}
                          value={vz.panX}
                          min={-panLimX}
                          max={panLimX}
                          step={1}
                          onChange={(v) => updateVz((p) => ({ ...p, panX: v }))}
                          marks={[{ value: 0 }]}
                        />
                        <FxSlider
                          label="Y (move up / down)"
                          display={`${Math.round(vz.panY)}%`}
                          value={vz.panY}
                          min={-panLimY}
                          max={panLimY}
                          step={1}
                          onChange={(v) => updateVz((p) => ({ ...p, panY: v }))}
                          marks={[{ value: 0 }]}
                        />
                        <FxSlider
                          label="Stretch horizontal"
                          display={`${Math.round(vz.stretchX * 100)}%`}
                          value={vz.stretchX}
                          min={STRETCH_MIN}
                          max={STRETCH_MAX}
                          step={0.05}
                          onChange={(v) => updateVz((p) => ({ ...p, stretchX: v }))}
                          marks={[{ value: 1 }]}
                        />
                        <FxSlider
                          label="Stretch vertical"
                          display={`${Math.round(vz.stretchY * 100)}%`}
                          value={vz.stretchY}
                          min={STRETCH_MIN}
                          max={STRETCH_MAX}
                          step={0.05}
                          onChange={(v) => updateVz((p) => ({ ...p, stretchY: v }))}
                          marks={[{ value: 1 }]}
                        />
                      </>
                    )}
                    <Text size="10px" c="dimmed" style={{ lineHeight: 1.5 }}>
                      + / − zoom · [ vertical stretch · ] horizontal stretch (Shift to shrink) ·
                      Shift+W/A/S/D or right-click drag to move · Shift+scroll zooms at the
                      pointer. Zoom, move and stretch switch to Custom.
                    </Text>
                  </EffectSection>

                  <Divider my={4} />

                  <EffectSection
                    title="Audio Effects"
                    open={audioSectionOpen}
                    onToggle={() => setAudioSectionOpen((o) => !o)}
                    active={afxActive}
                    onReset={() => setAfx({ ...DEFAULT_AUDIO_FX })}
                  >
                    <FxSlider
                      label="Pitch"
                      display={`${afx.pitch > 0 ? '+' : ''}${afx.pitch} st`}
                      value={afx.pitch}
                      min={-12}
                      max={12}
                      step={1}
                      color="violet"
                      onChange={(v) => setA({ pitch: v })}
                      marks={[{ value: 0 }]}
                    />
                    <Text size="10px" c="dimmed" style={{ marginTop: -4 }}>
                      Pitch also changes playback speed, same as the audio player.
                    </Text>
                    <FxSlider
                      label="Reverb"
                      display={`${Math.round(afx.reverbWet * 100)}%`}
                      value={afx.reverbWet}
                      min={0}
                      max={1}
                      step={0.05}
                      color="violet"
                      onChange={(v) => setA({ reverbWet: v })}
                    />
                    <FxSlider
                      label="Sub Bass (~60 Hz)"
                      display={formatDb(afx.subBass)}
                      value={afx.subBass}
                      min={-EQ_MAX_DB}
                      max={EQ_MAX_DB}
                      step={1}
                      color="teal"
                      onChange={(v) => setA({ subBass: v })}
                      marks={[{ value: 0 }]}
                    />
                    <FxSlider
                      label="Bass (~150 Hz)"
                      display={formatDb(afx.bass)}
                      value={afx.bass}
                      min={-EQ_MAX_DB}
                      max={EQ_MAX_DB}
                      step={1}
                      color="teal"
                      onChange={(v) => setA({ bass: v })}
                      marks={[{ value: 0 }]}
                    />
                    <FxSlider
                      label="Treble (~6 kHz)"
                      display={formatDb(afx.treble)}
                      value={afx.treble}
                      min={-EQ_MAX_DB}
                      max={EQ_MAX_DB}
                      step={1}
                      color="teal"
                      onChange={(v) => setA({ treble: v })}
                      marks={[{ value: 0 }]}
                    />
                  </EffectSection>
                </GlassScroll>
              </Popover.Dropdown>
            </Popover>

            {/* Volume — hover the icon (or the open panel) and scroll.
                Turns orange above 100%. */}
            <Popover
              width={280}
              position="top"
              shadow="md"
              withArrow={false}
              opened={volumeOpen}
              onChange={setVolumeOpen}
              portalProps={portalProps}
              middlewares={menuMiddlewares}
              classNames={{ dropdown: PLAYER_GLASS_POPOVER_CLASS }}
            >
              <Popover.Target>
                <Box
                  ref={volumeAnchorRef}
                  onWheel={onWheelAdjust((dir) => adjustVolumeRelative(dir * 5))}
                >
                  <Tooltip
                    label={`Volume: ${muted ? 'Muted (0%)' : `${volumePct}%`} (scroll to adjust, M to mute)`}
                    withinPortal
                    portalProps={portalProps}
                  >
                    <ActionIcon
                      variant="subtle"
                      color={boosted ? 'orange' : 'gray'}
                      size="md"
                      aria-label="Volume"
                      onClick={() => setVolumeOpen((o) => !o)}
                      style={{
                        color: muted ? '#fd6b6b' : boosted ? BOOST_COLOR : undefined,
                        backgroundColor: muted
                          ? 'rgba(128, 128, 128, 0.5)'
                          : boosted
                            ? BOOST_BG
                            : undefined
                      }}
                    >
                      {muted ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
                    </ActionIcon>
                  </Tooltip>
                </Box>
              </Popover.Target>
              <Popover.Dropdown
                style={{ padding: '8px 12px' }}
                onWheel={onWheelAdjust((dir) => adjustVolumeRelative(dir * 5))}
              >
                <GlassScroll maxHeight={volumeMaxH - 20}>
                  <Group gap="xs" wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={toggleMute}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                      style={{
                        color: muted ? '#fd6b6b' : boosted ? BOOST_COLOR : undefined,
                        backgroundColor: muted ? 'rgba(128, 128, 128, 0.5)' : undefined
                      }}
                    >
                      {muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
                    </ActionIcon>
                    <Slider
                      size="xs"
                      min={0}
                      max={VOLUME_MAX_PCT}
                      step={1}
                      value={isMuted ? 0 : Math.round(volume * 100)}
                      onChange={handleVolumeChange}
                      label={(val) => `${val}%`}
                      color={boosted ? 'orange' : 'indigo'}
                      style={{ flex: 1 }}
                      styles={{ thumb: sliderThumbStyle }}
                    />
                    <Text
                      size="xs"
                      style={{
                        width: 38,
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        color: boosted ? BOOST_COLOR : undefined
                      }}
                    >
                      {volumePct}%
                    </Text>
                    <UnstyledButton
                      onClick={() => {
                        setIsMuted(false);
                        setVolume(1);
                      }}
                    >
                      <Text size="xs" c="dimmed">
                        Reset
                      </Text>
                    </UnstyledButton>
                  </Group>
                </GlassScroll>
              </Popover.Dropdown>
            </Popover>

            <Tooltip
              label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              withinPortal
              portalProps={portalProps}
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="md"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Card>
    </Box>
  );

  return (
    <Box
      ref={wrapperRef}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minHeight: 0,
        position: 'relative',
        // Black in both themes (was var(--wh3d-viewport-bg), which is white in light mode).
        background: '#000'
      }}
    >
      <PlayerGlassStyles />

      {/* Video surface (overflow hidden so a zoomed picture is clipped to the player) */}
      <Box
        ref={surfaceRef}
        onMouseDown={handleSurfaceMouseDown}
        onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          background: '#000',
          overflow: 'hidden'
        }}
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            setVideoSize({
              w: e.currentTarget.videoWidth || 0,
              h: e.currentTarget.videoHeight || 0
            });
            // Re-apply persisted settings after the element finishes loading.
            e.currentTarget.volume = Math.max(0, Math.min(1, volume));
            e.currentTarget.muted = isMuted;
            e.currentTarget.preservesPitch = afx.pitch === 0;
            e.currentTarget.playbackRate = effectiveRate(speed, afx.pitch);
            e.currentTarget.loop = isLooping;
          }}
          onLoadedData={(e) => {
            setIsBuffering(false);
            if (autoPlay) {
              resumeGraph();
              void e.currentTarget.play().catch(() => undefined);
            }
          }}
          onCanPlay={() => setIsBuffering(false)}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onPlay={() => {
            setIsPlaying(true);
            resumeGraph();
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(e) => {
            if (!scrubbingRef.current) setCurrentTime(e.currentTarget.currentTime);
          }}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: videoObjectFit,
            display: 'block',
            background: '#000',
            cursor: error ? 'default' : 'pointer',
            filter: videoFilter,
            transform: videoTransform,
            transformOrigin: '50% 50%'
          }}
        />

        {isBuffering && !error && (
          <Center style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <Loader size="md" color="indigo" />
          </Center>
        )}

        {error && (
          <Center style={{ position: 'absolute', inset: 0, padding: 16 }}>
            <Alert
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={16} />}
              title="Can’t play this video"
              maw={420}
            >
              <Text size="xs">{error}</Text>
              {errorDetail && (
                <Text
                  size="10px"
                  c="dimmed"
                  mt={6}
                  style={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                >
                  {errorDetail}
                </Text>
              )}
            </Alert>
          </Center>
        )}

        {overlayControls && controlBar}
      </Box>

      {/* Control bar: under the video by default */}
      {!overlayControls && controlBar}

      {/* Reset confirmation (R key or middle mouse button) */}
      <Modal
        opened={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        title="Reset Video Settings"
        centered
        size="sm"
        portalProps={portalProps}
        classNames={{ content: PLAYER_GLASS_POPOVER_CLASS }}
        overlayProps={{ backgroundOpacity: 0.35, blur: 3 }}
      >
        <Stack gap="md">
          <Text size="sm">
            Reset speed, volume, loop, scale and position, and all video and audio effects back to
            defaults?
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setConfirmResetOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={confirmResetEffects}>
              Reset Effects
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}