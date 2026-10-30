import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { handleKey, matchesAction } from '../keybinds';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  Popover,
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
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat
} from '@tabler/icons-react';
import { PlayerGlassStyles, PLAYER_GLASS_CLASS, PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';
import { useVerticalDragGesture } from '../util/gestures';
import { MediaMenuSections, OutputDeviceList } from './PlayerMediaMenu';
import { PlayerContextMenu, OptionList } from './PlayerContextMenu';
import { FontList, resolveSubFont } from './SubtitleFonts';
import { applyOutput, outputStore, useAudioOutput } from './audioOutput';
import { parseVtt, cueAt, type SubCue } from './subtitleCues';
import type { CtxSnapshot } from './ContextMenuWindow';
import { VIDEO_COMPACT_BAR, videoCompactBarCss } from '@shared/transition';
import {
  BOOST_COLOR,
  PlaybackIndicators,
  VolumeIcon,
  usePlaybackIndicators
} from './PlaybackIndicators';
import {
  EffectSection,
  FxSlider,
  GlassScroll,
  Dim,
  EqControls,
  GlassSegmented,
  PlayerSettingsMenu,
  ReverbControls
} from './PlayerMenu';
import {
  EQ_HEADROOM,
  PITCH_MAX_ST,
  PITCH_MIN_ST,
  SPEED_PRESETS,
  buildReverbImpulse,
  createPitchCorrector,
  fxPresetsStore,
  useMenuMaxHeight,
  useReverbParams,
  sliderThumbStyle,
  type PitchCorrector,
  type PitchMode,
  type ModularSettings,
  DEFAULT_MODULAR,
  anyModular,
  normalizeModular,
  rollModular
} from './playerShared';

/** The preview's display modes. PreviewPane owns the real state. */
export type PreviewMode = 'normal' | 'expand' | 'fullscreen' | 'mini';

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
  /** Fullscreen = the preview fills the whole app window with an animation.
   *  PreviewPane owns the state (it is not OS fullscreen, so it can animate). */
  isFullscreen?: boolean;
  onFullscreen?: () => void;
  /** Mini player (I key). Passed by PreviewPane. */
  onMini?: () => void;
  /** Switch the preview to a specific mode (PreviewPane implements this).
   *  'normal' means "leave mini / go back to wherever it was". Used by the
   *  double-click, the F / T keys and the drag up / down gesture. */
  onSetMode?: (mode: PreviewMode) => void;
  isMini?: boolean;
  /** Compact mode = the mini player's "hide title bar" state. The control bar
   *  collapses to just the seek slider (no glass box), floats over the video and
   *  auto-hides after 2 s without mouse movement. PreviewPane should also hide
   *  its own header while this is true. */
  compact?: boolean;
  /** Shown at the left / right end of the compact bar (PreviewPane passes its
   *  pin button and its hide-title-bar (eye) button). Only rendered in compact mode. */
  compactStartSlot?: React.ReactNode;
  compactEndSlot?: React.ReactNode;
  /** Interface hidden (PreviewPane owns it). The right-click menu toggles it. */
  chromeHidden?: boolean;
  onToggleChrome?: () => void;
}

// Same volume range/snap as AudioPlayer. Above 100% goes through a Web Audio gain node.
const VOLUME_MAX_PCT = 200;
const VOLUME_SNAP_LOW = 94;
const VOLUME_SNAP_HIGH = 125;

// Background tint for "volume boosted above 100%" (the orange itself is BOOST_COLOR).
const BOOST_BG = 'rgba(255, 146, 43, 0.18)';

// Drag distance for the up / down gesture: see ../util/gestures (default 70px).

// Two clicks on the picture count as a double-click (-> fullscreen, like the F key) only when
// they are this close together in time and place.
const DOUBLE_CLICK_MS = 300;
const DOUBLE_CLICK_SLOP_PX = 8;

// CSS variables read by the collapse animation in transition.ts (section 6):
// the size the element collapses from, and its spacing (which collapses too).
const collapseVars = (max: string, mr = '0px', ml = '0px') =>
  ({
    '--gam-collapse-max': max,
    '--gam-collapse-mr': mr,
    '--gam-collapse-ml': ml
  }) as React.CSSProperties;

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
  pitchMode: PitchMode; // off | shift (pitch + speed together) | correct (pitch only)
  pitch: number; // semitones, for whichever pitch mode is on
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
  pitchMode: 'shift',
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
  modular: ModularSettings;
  isLooping: boolean;
  loopTouched: boolean; // GAM-LOOP: true once the user toggled loop themselves
} & VideoFx &
  AudioFx;

const DEFAULT_VIDEO_PREFS: PersistedVideoPrefs = {
  speed: 1,
  volume: 1,
  isLooping: true, // GAM-LOOP: on by default
  loopTouched: false,
  modular: { ...DEFAULT_MODULAR },
  ...DEFAULT_VIDEO_FX,
  ...DEFAULT_AUDIO_FX
};

const STORAGE_KEY = 'wh3d_video_player_prefs';

const loadPrefs = (): PersistedVideoPrefs => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Pitch correction was removed: pitch always changes pitch AND speed together.
      parsed.pitchMode = 'shift';
      const merged = {
        ...DEFAULT_VIDEO_PREFS,
        ...parsed,
        modular: normalizeModular(parsed.modular)
      } as PersistedVideoPrefs;
      // Until the user turns loop off themselves, it is on.
      if (!merged.loopTouched) merged.isLooping = true;
      return merged;
    }
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
    persistedPrefs = {
      ...DEFAULT_VIDEO_PREFS,
      isLooping: persistedPrefs.isLooping,
      loopTouched: persistedPrefs.loopTouched
    };
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

interface VideoAudioGraph {
  ctx: AudioContext;
  video: HTMLVideoElement;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  pitchFx: PitchCorrector;
  sub: BiquadFilterNode;
  bass: BiquadFilterNode;
  treble: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
}

// createMediaElementSource() may only be called ONCE per <video>. Calling it again
// (React StrictMode double effects, remounts) throws, and a disconnected source
// leaves the element silent/stalled. So the graph is cached per element and reused.
const graphCache = new WeakMap<HTMLVideoElement, VideoAudioGraph>();

/** Same chain as AudioPlayer: preamp -> pitch correction -> sub shelf -> bass peak
 *  -> treble shelf -> dry/reverb mix -> limiter. Volume stays on the <video> element. */
const buildVideoAudioGraph = (video: HTMLVideoElement): VideoAudioGraph => {
  const cached = graphCache.get(video);
  if (cached) return cached;
  const ctx = getSharedAudioContext();
  const source = ctx.createMediaElementSource(video);

  const preamp = ctx.createGain();
  const pitchFx = createPitchCorrector(ctx);

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
  convolver.buffer = buildReverbImpulse(ctx, fxPresetsStore.reverbParams());

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  source.connect(preamp);
  preamp.connect(pitchFx.input);
  pitchFx.output.connect(sub);
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
    pitchFx,
    sub,
    bass,
    treble,
    dry,
    wet,
    convolver,
    boost,
    limiter
  };
  graphCache.set(video, graph);
  return graph;
};

const applyAudioFx = (g: VideoAudioGraph, fx: AudioFx, volume: number, correctSt: number) => {
  const t = g.ctx.currentTime;
  g.pitchFx.setSemitones(correctSt);
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

interface SubCfg {
  delay: number;
  size: number;
  lift: number;
  font: string;
  color: string;
  boxOn: boolean;
  box: string;
  boxAlpha: number;
  outline: number;
  shadow: number;
}

const DEFAULT_SUB: SubCfg = {
  delay: 0,
  size: 1,
  lift: 0,
  font: 'auto',
  color: '#ffffff',
  boxOn: true,
  box: '#000000',
  boxAlpha: 0.55,
  outline: 0,
  shadow: 3
};


const SUB_PRESETS: { label: string; cfg: Partial<SubCfg> }[] = [
  {
    label: 'Classic: white on black box',
    cfg: { color: '#ffffff', boxOn: true, box: '#000000', boxAlpha: 0.65, outline: 0, shadow: 0 }
  },
  {
    label: 'White on gray box',
    cfg: { color: '#ffffff', boxOn: true, box: '#5a5a5a', boxAlpha: 0.85, outline: 0, shadow: 0 }
  },
  {
    label: 'Yellow, black outline',
    cfg: { color: '#ffe44d', boxOn: false, outline: 1.5, shadow: 4 }
  },
  {
    label: 'White, black outline',
    cfg: { color: '#ffffff', boxOn: false, outline: 1.5, shadow: 3 }
  },
  {
    label: 'Cinema: soft shadow',
    cfg: { color: '#ffffff', boxOn: false, outline: 0, shadow: 9 }
  }
];

function hexRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function subTextShadow(c: SubCfg): string {
  const parts: string[] = [];
  if (c.outline > 0) {
    const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [x, y] of dirs) parts.push(`${x * c.outline}px ${y * c.outline}px 0 #000`);
  }
  if (c.shadow > 0) {
    parts.push(`0 2px ${c.shadow}px rgba(0, 0, 0, 0.95)`, `0 0 ${c.shadow * 2}px rgba(0, 0, 0, 0.6)`);
  }
  return parts.length ? parts.join(', ') : 'none';
}

export function VideoPlayer({
  libraryId,
  fileId,
  filename,
  ext,
  autoPlay = false,
  overlayControls = false,
  isFullscreen = false,
  onFullscreen,
  onMini,
  onSetMode,
  isMini = false,
  compact = false,
  compactStartSlot,
  compactEndSlot,
  chromeHidden,
  onToggleChrome
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  const graphRef = useRef<VideoAudioGraph | null>(null);
  const resetOpenRef = useRef(false);
  // Time + position of the last click on the picture (our own double-click check).
  const lastClickRef = useRef({ t: 0, x: 0, y: 0 });
  // Left button held + drag up = fullscreen, drag down = mini player.
  // The drag logic lives in ../util/gestures (shared with the audio player).
  // setMode is declared further down; it is only called when the gesture fires.
  const gesture = useVerticalDragGesture({
    onGesture: (dir) => {
      if (dir === 'up') {
        if (!isFullscreen) setMode('fullscreen');
      } else if (!isMini) {
        setMode('mini');
      }
    }
  });

  // Anchor used to measure how much room the volume menu has above the control bar.
  // (The merged speed / pitch / effects menu measures itself inside PlayerMenu.tsx.)
  const volumeAnchorRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Fallback: a remuxed copy (audio re-encoded to plain stereo AAC-LC) for files Chromium can't decode.
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const triedFallbackRef = useRef(false);
  useEffect(() => {
    setFallbackSrc(null);
    triedFallbackRef.current = false;
  }, [libraryId, fileId]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(() => videoPrefsStore.get().volume);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(() => videoPrefsStore.get().speed);
  const [isLooping, setIsLooping] = useState(() => videoPrefsStore.get().isLooping);
  // Modular pitch / speed: a new random roll each time the video starts or loops.
  const [modular, setModular] = useState<ModularSettings>(() => videoPrefsStore.get().modular);
  const modularRef = useRef(modular);
  modularRef.current = modular;
  const [roll, setRoll] = useState({ p: 1, s: 1, v: 1 });
  const lastTimeRef = useRef(0);
  const rerollModular = useCallback(() => {
    const r = rollModular(modularRef.current);
    setRoll({ p: r.p, s: r.s, v: r.v });
  }, []);
  const [volumeOpen, setVolumeOpen] = useState(false);

  // ---- Subtitles (GAM-SUBS2) ----
  // Sidecar files (.srt / .vtt / .ass next to the video) are converted to WebVTT by the main
  // process (subtitles:list). They are painted by us (overlay further down) instead of a <track>,
  // because blob: media can be blocked by the app's CSP. Pickers: volume menu + right-click menu.
  const [subs, setSubs] = useState<{ label: string; cues: SubCue[] }[]>([]);
  const [subIndex, setSubIndex] = useState(-1); // -1 = off; on by default when a file exists
  const [subsOpen, setSubsOpen] = useState(false); // (kept so older references still compile)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let dead = false;
    const api = (window as any).gam;
    if (!api?.listSubtitles) console.warn('[subtitles] window.gam.listSubtitles is missing (preload)');
    Promise.resolve(api?.listSubtitles?.(libraryId, fileId))
      .then((list: { label: string; vtt: string }[] | undefined) => {
        if (dead || !list) return;
        console.info('[subtitles]', list.length, 'file(s) found');
        const tracks = list.map((s) => ({ label: s.label, cues: parseVtt(s.vtt) }));
        setSubs(tracks);
        setSubIndex(tracks.length ? 0 : -1);
      })
      .catch((err: unknown) => console.warn('[subtitles] listing failed', err));
    return () => {
      dead = true;
      setSubs([]);
      setSubIndex(-1);
    };
  }, [libraryId, fileId]);
  // Subtitle settings: delay (s, + = later), size multiplier, extra height (px). Saved.
  const [subCfg, setSubCfg] = useState<SubCfg>(() => {
    try {
      const p = JSON.parse(localStorage.getItem('gam:subCfg') ?? 'null');
      return { ...DEFAULT_SUB, ...(p && typeof p === 'object' ? p : {}) };
    } catch {
      return { ...DEFAULT_SUB };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('gam:subCfg', JSON.stringify(subCfg));
    } catch {
      // ignore
    }
  }, [subCfg]);
  const shiftDragRef = useRef(false);
  const subText =
    subIndex >= 0 && subs[subIndex] ? cueAt(subs[subIndex].cues, currentTime - subCfg.delay) : '';

  // ---- Embedded audio tracks (e.g. an .mkv with German + English) ----
  // Needs Chromium's AudioVideoTracks flag (src/main/ipc/media-flags.ts). Without it the list stays empty.
  const [audioTracks, setAudioTracks] = useState<{ label: string; enabled: boolean }[]>([]);
  useEffect(() => {
    const v = videoRef.current as any;
    const list = v?.audioTracks;
    if (!v || !list) {
      setAudioTracks([]);
      return undefined;
    }
    const read = () => {
      const out: { label: string; enabled: boolean }[] = [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const name = [t.label, t.language && t.language !== t.label ? t.language : '']
          .filter(Boolean)
          .join(' \u00b7 ');
        out.push({ label: name || `Track ${i + 1}`, enabled: !!t.enabled });
      }
      setAudioTracks(out);
    };
    read();
    list.addEventListener?.('addtrack', read);
    list.addEventListener?.('removetrack', read);
    list.addEventListener?.('change', read);
    v.addEventListener('loadedmetadata', read);
    return () => {
      list.removeEventListener?.('addtrack', read);
      list.removeEventListener?.('removetrack', read);
      list.removeEventListener?.('change', read);
      v.removeEventListener('loadedmetadata', read);
    };
  }, [fileId]);
  const selectAudioTrack = (index: number) => {
    const list = (videoRef.current as any)?.audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].enabled = i === index;
    setAudioTracks((prev) => prev.map((t, i) => ({ ...t, enabled: i === index })));
  };

  // ---- Output device (shared with AudioPlayer, saved between launches) ----
  const audioOut = useAudioOutput();
  useEffect(() => {
    void applyOutput(audioOut.deviceId, [videoRef.current, graphRef.current?.ctx]);
  }, [audioOut.deviceId]);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  resetOpenRef.current = confirmResetOpen;

  // ---- Play / pause circle + status pill (shared with AudioPlayer) ----
  // See PlaybackIndicators.tsx. <PlaybackIndicators api={pi} /> renders them.
  const pi = usePlaybackIndicators();
  const { flashIndicator, flashHud, hitLimit } = pi;

  // Latest values for fast wheel spins and for effects that must not re-run.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const volumeOpenRef = useRef(volumeOpen);
  volumeOpenRef.current = volumeOpen;

  // Sizes used to keep a rotated (90/270) picture inside the player.
  const [surfaceSize, setSurfaceSize] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  // Speed / pitch / effects menu (one button, see PlayerMenu.tsx)
  const [fxOpen, setFxOpen] = useState(false);
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
      pitchMode: p.pitchMode,
      pitch: p.pitch,
      reverbWet: p.reverbWet,
      subBass: p.subBass,
      bass: p.bass,
      treble: p.treble
    };
  });

  // Pitch shifter: pitch AND speed change together (playback rate follows the pitch).
  // Pitch correction: pitch changes, speed stays the same (the pitch node in the graph).
  const pitchOn = modular.pitchOn;
  const speedOn = modular.speedOn;
  const volumeOn = modular.volumeOn;
  // A modular option replaces the regular control while it is on.
  const baseSt = pitchOn ? 12 * Math.log2(roll.p) : afx.pitch;
  // Modular pitch is never corrected (it sounds robotic); otherwise the checkbox decides.
  const corrOn = !pitchOn && afx.pitchMode !== 'shift';
  const shiftSt = corrOn ? 0 : baseSt;
  const correctSt = corrOn ? baseSt : 0;
  const speedEff = speedOn ? roll.s : speed;
  const volEff = volumeOn ? roll.v : volume;

  // Room above the volume menu's button (updates live while the menu is open).
  const volumeMaxH = useMenuMaxHeight(volumeOpen, volumeAnchorRef, wrapperRef);

  // ---- Compact mode (title bar hidden): slim bar that hides after 2 s ----
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barShown, setBarShown] = useState(true);
  const [barH, setBarH] = useState(0); // full-size bar height, so the video can reserve room for it
  const barHoverRef = useRef(false);
  const barTimerRef = useRef<number | undefined>(undefined);
  const menusOpenRef = useRef(false);
  menusOpenRef.current = fxOpen || volumeOpen || subsOpen || confirmResetOpen || !!ctxMenu;

  // I / F shortcuts: close the menus with no fade-out BEFORE the window resizes.
  const [instantClose, setInstantClose] = useState(false);
  const closeMenusNow = () => {
    flushSync(() => {
      setInstantClose(true);
      setFxOpen(false);
      setVolumeOpen(false);
      setSubsOpen(false);
    });
    requestAnimationFrame(() => setInstantClose(false));
  };

  // Starts (or restarts) the hide countdown. While the pointer is on the bar,
  // a slider is being dragged or a menu is open, the bar stays and checks again.
  const armBarHide: () => void = useCallback(() => {
    window.clearTimeout(barTimerRef.current);
    barTimerRef.current = window.setTimeout(() => {
      if (barHoverRef.current || menusOpenRef.current || scrubbingRef.current) {
        armBarHide();
        return;
      }
      setBarShown(false);
    }, VIDEO_COMPACT_BAR.autoHideMs);
  }, []);

  // Entering / leaving compact mode: show the bar, and (in compact) start the countdown.
  useEffect(() => {
    window.clearTimeout(barTimerRef.current);
    setBarShown(true);
    // GAM-COMPACT-V2: wait for the leave animation before the 1 s countdown starts.
    let startTimer: number | undefined;
    if (compact) startTimer = window.setTimeout(armBarHide, VIDEO_COMPACT_BAR.durationMs);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(barTimerRef.current);
    };
  }, [compact, armBarHide]);

  // A menu closing restarts the countdown.
  useEffect(() => {
    if (compact) armBarHide();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxOpen, volumeOpen, subsOpen, confirmResetOpen, armBarHide]);

  // Any mouse movement over the player brings the bar back.
  const handlePlayerMouseMove = () => {
    if (!compact) return;
    setBarShown(true);
    armBarHide();
  };

  // Measure the full-size bar (not while compact, when it is slim).
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || compact) return;
    const update = () => setBarH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  // Room kept under the video for the bar. 0 when the bar floats over the video
  // (overlayControls, or compact), so the video grows smoothly into that space.
  const reservedBottom = overlayControls || compact ? 0 : barH;

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

  // Rotate lives in the Scale & Position section now, so it lights that section up.
  const scaleActive = !isDefaultVz(vz) || vfx.rotate !== 0;

  const vfxActive =
    vfx.brightness !== 100 ||
    vfx.contrast !== 100 ||
    vfx.saturation !== 100 ||
    vfx.hue !== 0 ||
    vfx.flip ||
    vfx.flipV;
  // Pitch, reverb and EQ (all live in the Audio Effects section).
  const toneActive =
    afx.pitch !== 0 ||
    afx.reverbWet !== 0 ||
    afx.subBass !== 0 ||
    afx.bass !== 0 ||
    afx.treble !== 0;
  const afxActive = afx.pitch !== 0 || toneActive || pitchOn;

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

  const src = fallbackSrc ?? `wh3d-file://${libraryId}/${fileId}`;

  // Fullscreen is no longer OS fullscreen (PreviewPane fills the app window
  // with an animation instead), so menus and tooltips can portal to
  // document.body as usual and still sit above the video.
  const portalProps = undefined;

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
    v.volume = Math.max(0, Math.min(1, volEff));
    v.muted = isMuted;
    videoPrefsStore.set({ volume });
  }, [volume, isMuted, volEff]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Only the pitch shifter changes the rate; pitch correction leaves it alone.
    const rate = effectiveRate(speedEff, shiftSt);
    // With the pitch shifter we want the pitch to follow the rate; otherwise keep
    // the browser's default (speed changes without changing pitch).
    v.preservesPitch = shiftSt === 0;
    // defaultPlaybackRate survives the load algorithm; playbackRate alone is reset by it.
    v.defaultPlaybackRate = rate;
    v.playbackRate = rate;
    videoPrefsStore.set({ speed });
  }, [speed, shiftSt, speedEff]);

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

  useEffect(() => {
    videoPrefsStore.set({ modular });
  }, [modular]);

  // Turning modular on rolls a first random pitch / speed.
  useEffect(() => {
    if (anyModular(modular)) rerollModular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modular.pitchOn, modular.volumeOn, modular.speedOn, rerollModular]);

  // ---- Status pill: shows whenever speed / loop / volume / mute CHANGES, no
  // matter where the change came from (keyboard, menu, scroll, slider). Each
  // effect compares against the previous value, so the first render (and
  // StrictMode's double run) never shows the pill.
  const prevSpeedRef = useRef(speed);
  useEffect(() => {
    if (prevSpeedRef.current === speed) return;
    prevSpeedRef.current = speed;
    flashHud({ kind: 'speed', text: `${speed}x` });
  }, [speed, flashHud]);

  const prevLoopRef = useRef(isLooping);
  useEffect(() => {
    if (prevLoopRef.current === isLooping) return;
    prevLoopRef.current = isLooping;
    flashHud({ kind: isLooping ? 'loop-on' : 'loop-off', text: isLooping ? 'Loop on' : 'Loop off' });
  }, [isLooping, flashHud]);

  const prevShownVolRef = useRef(isMuted ? 0 : volume);
  useEffect(() => {
    const shown = isMuted ? 0 : volume;
    if (prevShownVolRef.current === shown) return;
    prevShownVolRef.current = shown;
    // The volume popover has its own slider, so no pill while it is open.
    if (volumeOpenRef.current) return;
    const pct = Math.round(shown * 100);
    flashHud({
      kind: 'volume',
      text: shown === 0 ? 'Muted' : `${pct}%`,
      pct,
      boosted: shown > 1
    });
  }, [volume, isMuted, flashHud]);

  // The Web Audio graph is only built once an audio effect is on or volume is
  // boosted above 100%, so plain playback never goes through it.
  useEffect(() => {
    if (!afxActive && volEff <= 1 && !graphRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    if (!graphRef.current) {
      try {
        graphRef.current = buildVideoAudioGraph(v);
        void applyOutput(outputStore.get(), [graphRef.current.ctx]);
      } catch (e) {
        console.error('[VideoPlayer] could not start the audio effects engine', e);
        return;
      }
    }
    applyAudioFx(graphRef.current, afx, volEff, correctSt);
    if (graphRef.current.ctx.state === 'suspended') {
      void graphRef.current.ctx.resume().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afx, volume, volEff, correctSt]);

  // Reverb preset / Custom values changed: rebuild the reverb tail. The short delay
  // keeps a Custom slider drag from rebuilding it on every tick.
  const reverbParams = useReverbParams();
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return undefined;
    const id = window.setTimeout(() => {
      g.convolver.buffer = buildReverbImpulse(g.ctx, reverbParams);
    }, 120);
    return () => window.clearTimeout(id);
  }, [reverbParams]);

  useEffect(() => {
    return () => {
      const g = graphRef.current;
      graphRef.current = null;
      if (!g) return;
      // Dev/StrictMode runs this cleanup while the element is still mounted.
      // Tearing the graph down then would orphan the element's audio, so only
      // disconnect when the <video> has really left the DOM.
      if (g.video.isConnected) return;
      g.pitchFx.dispose();
      try {
        g.source.disconnect();
      } catch {}
      try {
        g.limiter.disconnect();
      } catch {}
      graphCache.delete(g.video);
    };
  }, []);

  // (drag-gesture cleanup now lives inside useVerticalDragGesture)

  // Close open menus when fullscreen toggles, so none are left floating
  // mid-animation at the old position.
  useEffect(() => {
    setFxOpen(false);
    setVolumeOpen(false);
    setSubsOpen(false);
    setCtxMenu(null);
  }, [isFullscreen, isMini, compact]);

  // Scroll wheel over the picture:
  //   plain scroll  = volume (up = louder), works even when the window is not focused
  //   Shift + scroll = zoom toward the mouse pointer (the point under the cursor stays put)
  // Native listener so preventDefault works (React's wheel handlers are passive).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    let wheelAcc = 0; // touchpads send many tiny deltas; a mouse notch is ~100
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) {
        // The control bar keeps its own per-button scroll behaviour.
        if ((e.target as HTMLElement | null)?.closest('[data-vp-controls]')) return;
        e.preventDefault();
        e.stopPropagation();
        wheelAcc += e.deltaY;
        const steps = Math.trunc(Math.abs(wheelAcc) / 100);
        if (steps === 0) return;
        const dir = wheelAcc < 0 ? 1 : -1; // scroll up = louder
        wheelAcc -= Math.sign(wheelAcc) * steps * 100;
        actionsRef.current.adjustVolumeRelative(dir * steps * 5);
        return;
      }
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

  // Mouse buttons on the picture:
  //   left  held + drag up   = fullscreen, drag down = mini player
  //   right held + drag      = move the picture
  const handleSurfaceMouseDown = (e: React.MouseEvent) => {
    const el = surfaceRef.current;
    if (!el) return;

    if (e.button === 0 && !e.shiftKey) {
      gesture.onMouseDown(e);
      return;
    }

    if (e.button !== 0 || !e.shiftKey) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let lastX = e.clientX;
    let lastY = e.clientY;
    let moved = 0; // GAM-SUBS: % of the player moved while the right button was down
    const onMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - lastX) / rect.width) * 100;
      const dy = ((ev.clientY - lastY) / rect.height) * 100;
      lastX = ev.clientX;
      lastY = ev.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      panBy(dx, dy);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      shiftDragRef.current = true;
      window.setTimeout(() => {
        shiftDragRef.current = false;
      }, 0);
      if (moved < 0.6) {
        // a plain right-click, not a pan
        setFxOpen(false);
        setVolumeOpen(false);
        void ev;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ---- Actions ----
  // The circle shows for every toggle: clicks on the picture, the control-bar
  // button and the keyboard.
  const togglePlay = (showIndicator = true) => {
    const v = videoRef.current;
    if (!v || error) return;
    if (graphRef.current?.ctx.state === 'suspended') {
      void graphRef.current.ctx.resume().catch(() => undefined);
    }
    const willPlay = v.paused || v.ended;
    if (willPlay) void v.play().catch(() => undefined);
    else v.pause();
    if (showIndicator) flashIndicator(willPlay ? 'play' : 'pause');
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
    flashHud({
      kind: direction === -1 ? 'back' : 'forward',
      text: `${direction === -1 ? '−' : '+'}${step}s`
    });
  };

  // Reads a ref so fast wheel spins never use a stale volume. When the volume
  // actually changes, the status pill comes from the volume effect above; when
  // it is already at an end, hitLimit() drives the shake / shrink reaction.
  const adjustVolumeRelative = (deltaPct: number) => {
    const cur = Math.round(volumeRef.current * 100);
    const pct = Math.max(0, Math.min(VOLUME_MAX_PCT, cur + deltaPct));
    if (pct === cur) {
      // Already at the end: nothing changes, but persisting makes the pill react.
      if (!volumeOpenRef.current) {
        if (deltaPct > 0 && cur >= VOLUME_MAX_PCT) {
          hitLimit('volume', 'max', {
            kind: 'volume',
            text: `${VOLUME_MAX_PCT}%`,
            pct: VOLUME_MAX_PCT,
            boosted: true
          });
        } else if (deltaPct < 0 && cur <= 0) {
          hitLimit('volume', 'min', { kind: 'volume', text: '0%', pct: 0 });
        }
      }
      return;
    }
    volumeRef.current = pct / 100;
    setIsMuted(false);
    setVolume(pct / 100);
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
    // Already at the fastest / slowest preset: persisting makes the pill react.
    if (direction === 'up' && closestIdx === SPEED_PRESETS.length - 1) {
      hitLimit('speed', 'max', { kind: 'speed', text: `${speed}x` });
      return;
    }
    if (direction === 'down' && closestIdx === 0) {
      hitLimit('speed', 'min', { kind: 'speed', text: `${speed}x` });
      return;
    }
    const nextIdx =
      direction === 'down'
        ? Math.max(0, closestIdx - 1)
        : Math.min(SPEED_PRESETS.length - 1, closestIdx + 1);
    setSpeed(SPEED_PRESETS[nextIdx]);
  };

  const toggleMute = () => setIsMuted((prev) => !prev);

  // Only the user turning loop on / off marks it as their own choice.
  const setLoopByUser = (on: boolean) => {
    videoPrefsStore.set({ loopTouched: true });
    setIsLooping(on);
  };

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
    // Loop is left exactly as it is.
    setVfx({ ...DEFAULT_VIDEO_FX });
    setAfx({ ...DEFAULT_AUDIO_FX });
    setModular({ ...d.modular });
    setVz({ ...DEFAULT_VZ });
    setConfirmResetOpen(false);
    // The speed/loop/volume effects above each flash their own pill after the
    // next render; this later call replaces them with a single "reset" pill.
    window.setTimeout(() => flashHud({ kind: 'reset', text: 'Settings reset' }), 60);
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

  // ---- Preview modes (fullscreen / mini / expand) ----
  // Mode state is owned by PreviewPane. When it passes onSetMode, every mode
  // change goes through it. Until then this falls back to the older
  // onFullscreen / onMini props, which can only do part of the job.
  // PreviewPane owns the modes. These call the same functions the I and F keys
  // use, so a gesture / double-click behaves exactly like pressing the key:
  //   I key -> onMini        (toggles mini; leaves fullscreen / expanded first)
  //   F key -> onFullscreen  (toggles fullscreen; from mini it leaves mini first)
  const setMode = (m: PreviewMode) => {
    if (onSetMode) {
      onSetMode(m);
      return;
    }
    if (m === 'fullscreen') {
      if (!isFullscreen) onFullscreen?.();
    } else if (m === 'mini') {
      if (!isMini) onMini?.();
    } else if (m === 'normal') {
      if (isMini) onMini?.();
    }
  };

  // F key.
  const toggleFullscreen = () => onFullscreen?.();

  // Mini toggle (the double-click on the picture now does what the F key does instead).
  const toggleMini = () => setMode(isMini ? 'normal' : 'mini');

  // Windows-style hover-to-scroll, same helper shape as AudioPlayer.
  const onWheelAdjust = (adjust: (dir: 1 | -1) => void) => (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) adjust(1);
    else if (e.deltaY > 0) adjust(-1);
  };

  // ---- Keyboard (same keymap as AudioPlayer, plus F for fullscreen (T is handled by PreviewPane)) ----
  const actionsRef = useRef({
    togglePlay,
    seekRelative,
    adjustVolumeRelative,
    changeSpeedStep,
    toggleMute,
    toggleFullscreen,
    toggleMini
  });
  useEffect(() => {
    actionsRef.current = {
      togglePlay,
      seekRelative,
      adjustVolumeRelative,
      changeSpeedStep,
      toggleMute,
      toggleFullscreen,
      toggleMini
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)) return;
      if (matchesAction(e, 'video.volumeMenu')) {
        if (resetOpenRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        setFxOpen(false);
        setVolumeOpen((o) => !o);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (resetOpenRef.current) return;

      const a = actionsRef.current;

      // I (mini / compact) and F (fullscreen): close any open menu first.
      if ((e.code === 'KeyI' || matchesAction(e, 'video.fullscreen')) && !e.shiftKey && menusOpenRef.current) {
        closeMenusNow();
      }

      // Bindings live in keybinds.ts (physical keys, so they work in any language).
      handleKey(e, 'video', {
        'video.playPause': (ev) => { ev.stopPropagation(); a.togglePlay(true); },
        'video.seekBack': () => a.seekRelative(-1),
        'video.seekForward': () => a.seekRelative(1),
        'video.volumeUp': () => a.adjustVolumeRelative(5),
        'video.volumeDown': () => a.adjustVolumeRelative(-5),
        'video.mute': () => a.toggleMute(),
        'video.speedDown': () => a.changeSpeedStep('down'),
        'video.speedUp': () => a.changeSpeedStep('up'),
        'video.speedReset': () => a.changeSpeedStep('reset'),
        'video.fullscreen': () => a.toggleFullscreen(),
        'video.reset': () => setConfirmResetOpen(true),
        'video.zoomIn': () => zoomBy(ZOOM_STEP),
        'video.zoomOut': () => zoomBy(-ZOOM_STEP),
        'video.stretchVPlus': () => stretchBy('y', STRETCH_STEP),
        'video.stretchVMinus': () => stretchBy('y', -STRETCH_STEP),
        'video.stretchHPlus': () => stretchBy('x', STRETCH_STEP),
        'video.stretchHMinus': () => stretchBy('x', -STRETCH_STEP),
        'video.panUp': (ev) => { ev.stopPropagation(); panBy(0, -PAN_STEP); },
        'video.panDown': (ev) => { ev.stopPropagation(); panBy(0, PAN_STEP); },
        'video.panLeft': (ev) => { ev.stopPropagation(); panBy(-PAN_STEP, 0); },
        'video.panRight': (ev) => { ev.stopPropagation(); panBy(PAN_STEP, 0); }
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [panBy, zoomBy, stretchBy]);

  // ---- <video> event handlers ----
  const handleError = () => {
    const code = videoRef.current?.error?.code;
    setErrorDetail(videoRef.current?.error?.message || null);
    console.error('[VideoPlayer] playback error', videoRef.current?.error);
    const gamApi = (window as any).gam;
    if (!triedFallbackRef.current && gamApi?.makePlayableVideo) {
      triedFallbackRef.current = true;
      setIsBuffering(true);
      Promise.resolve(gamApi.makePlayableVideo(libraryId, fileId))
        .then((url: string | null) => {
          if (url) {
            setError(null);
            setErrorDetail(null);
            setFallbackSrc(url);
          } else {
            setError('This fileâ€™s codec isnâ€™t supported by the built-in player.');
            setIsBuffering(false);
          }
        })
        .catch(() => {
          setError('This fileâ€™s codec isnâ€™t supported by the built-in player.');
          setIsBuffering(false);
        });
      return;
    }
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

  // ---- Right-click menu in its own window (mini player only) ----
  // The mini window is smaller than the menu, so there it is drawn by a separate window
  // (ContextMenuWindow.tsx, src/main/ipc/context-menu.ts) that sends its changes back here.
  const ctxOwnerRef = useRef(false);
  const ctxActionRef = useRef<(a: any) => void>(() => undefined);
  ctxActionRef.current = (a: any) => {
    switch (a.op) {
      case 'sub':
        setSubIndex(a.index);
        break;
      case 'track':
        selectAudioTrack(a.index);
        break;
      case 'output':
        outputStore.set(a.id);
        break;
      case 'vfx':
        setV(a.partial);
        break;
      case 'vfxReset':
        setVfx((p) => ({ ...DEFAULT_VIDEO_FX, rotate: p.rotate }));
        break;
      case 'scaleMode':
        updateVz((p) => ({ ...p, mode: a.mode as ScaleMode }));
        break;
      case 'chrome':
        onToggleChrome?.();
        break;
      case 'speed':
        setSpeed(a.value);
        break;
      case 'modular':
        setModular({ ...modularRef.current, ...a.partial });
        break;
      case 'subcfg':
        setSubCfg((c) => ({ ...c, ...a.partial }));
        break;
      case 'subPreset':
        setSubCfg((c) => ({ ...c, ...SUB_PRESETS[a.index].cfg }));
        break;
      case 'subReset':
        setSubCfg({ ...DEFAULT_SUB });
        break;
      case 'scaleReset':
        setVz({ ...DEFAULT_VZ });
        setV({ rotate: 0 });
        break;
      case 'afx':
        setA(a.partial);
        break;
      case 'afxReset':
        setAfx({ ...DEFAULT_AUDIO_FX });
        break;
    }
  };
  useEffect(() => {
    const g = (window as any).gam;
    if (!g?.onContextMenuAction) return undefined;
    return g.onContextMenuAction((a: unknown) => {
      if (ctxOwnerRef.current) ctxActionRef.current(a);
    }) as () => void;
  }, []);
  const openContextMenuAt = (ev: { clientX: number; clientY: number; screenX: number; screenY: number }) => {
    const g = (window as any).gam;
    if (isMini && g?.openContextMenu) {
      ctxOwnerRef.current = true;
      const snap: CtxSnapshot = {
        kind: 'video',
        subs: subs.map((s) => s.label),
        subIndex,
        tracks: audioTracks,
        vfx: { ...vfx },
        afx: {
          pitch: afx.pitch,
          reverbWet: afx.reverbWet,
          subBass: afx.subBass,
          bass: afx.bass,
          treble: afx.treble
        },
        scaleMode: vz.mode,
        speed,
        modular: {
          pitchOn: modular.pitchOn,
          speedOn: modular.speedOn,
          volumeOn: modular.volumeOn
        },
        subCfg: {
          delay: subCfg.delay,
          size: subCfg.size,
          lift: subCfg.lift,
          outline: subCfg.outline,
          shadow: subCfg.shadow,
          boxOn: subCfg.boxOn,
          boxAlpha: subCfg.boxAlpha
        },
        subPresets: SUB_PRESETS.map((p) => p.label),
        chromeHidden: !!chromeHidden,
        pitchOn,
        defaults: {
          vfx: { ...DEFAULT_VIDEO_FX },
          afx: { pitch: 0, reverbWet: 0, subBass: 0, bass: 0, treble: 0 }
        }
      };
      void g.openContextMenu({ x: ev.screenX, y: ev.screenY, state: snap });
      return;
    }
    setCtxMenu({ x: ev.clientX, y: ev.clientY });
  };

  const panLimX = panLimit(vz.zoom, vz.stretchX);
  const panLimY = panLimit(vz.zoom, vz.stretchY);

  const compactAttr = compact ? 'true' : 'false';
  const controlBar = (
    <Box
      ref={barRef}
      p="xs"
      data-vp-controls
      data-compact={compactAttr}
      data-shown={barShown ? 'true' : 'false'}
      className={VIDEO_COMPACT_BAR.boxClassName}
      onMouseEnter={() => {
        barHoverRef.current = true;
      }}
      onMouseLeave={() => {
        barHoverRef.current = false;
        if (compact) armBarHide();
      }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 }}
    >
      <Card
        withBorder={false}
        radius="lg"
        p="xs"
        className={`${PLAYER_GLASS_CLASS} ${VIDEO_COMPACT_BAR.barClassName}`}
        data-compact={compactAttr}
        style={{ width: '100%' }}
      >
        <Group wrap="nowrap" gap={0} align="center">
          {/* Pin button (from PreviewPane), only in compact mode */}
          <div className={VIDEO_COMPACT_BAR.revealClassName} style={{ marginRight: 8 }}>
            {compactStartSlot}
          </div>

          <div
            className={VIDEO_COMPACT_BAR.collapseClassName}
            style={{ flexShrink: 0, ...collapseVars('56px', '16px') }}
          >
          <ActionIcon
            variant="filled"
            color="indigo"
            radius="xl"
            size={42}
            onClick={() => togglePlay()}
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
          </div>

          <Box
            className={VIDEO_COMPACT_BAR.collapseClassName}
            style={{ flexShrink: 1, flexGrow: 0, minWidth: 0, ...collapseVars('180px', '16px') }}
          >
            <Text size="xs" fw={700} truncate>
              {filename}
            </Text>
            <Text size="10px" c="dimmed" style={{ fontFamily: 'monospace' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </Box>

          {/* Seek bar */}
          <Box className="gam-vp-seek" style={{ flex: '1 1 140px', minWidth: 140, display: 'flex', alignItems: 'center' }}>
            <Slider
              size="sm"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={(val) => {
                scrubbingRef.current = true;
                seekTo(val);
                // Show where the click / drag landed (e.g. 1:32) in the status pill.
                flashHud({ kind: 'seek', text: formatTime(val) });
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

          <div
            className={VIDEO_COMPACT_BAR.collapseClassName}
            style={{ flexShrink: 0, ...collapseVars('240px', '0px', '16px') }}
          >
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
                onClick={() => setLoopByUser(!isLooping)}
                onWheel={onWheelAdjust((dir) => setLoopByUser(dir === 1))}
                aria-label="Toggle loop"
              >
                <IconRepeat size={16} />
              </ActionIcon>
            </Tooltip>

            {/* One menu: Speed, Pitch, Video Effects, Scale & Position, Audio Effects
                (the same menu component AudioPlayer uses, see PlayerMenu.tsx) */}
            <PlayerSettingsMenu
              speed={speed}
              onSpeed={setSpeed}
              modular={modular}
              onModular={setModular}
              extraActive={vfxActive || scaleActive || toneActive}
              opened={fxOpen}
              onOpenedChange={setFxOpen}
              watchRef={wrapperRef}
              instantClose={instantClose}
              onWheelSpeed={(dir) => changeSpeedStep(dir === 1 ? 'up' : 'down')}
              extraSections={(acc) => (
                <>
                  <Divider my={4} />

                  <EffectSection
                    title="Video Effects"
                    open={acc.isOpen('video')}
                    onToggle={() => acc.toggle('video')}
                    active={vfxActive}
                    onReset={() => setVfx((p) => ({ ...DEFAULT_VIDEO_FX, rotate: p.rotate }))}
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
                    open={acc.isOpen('scale')}
                    onToggle={() => acc.toggle('scale')}
                    active={scaleActive}
                    onReset={() => {
                      setVz({ ...DEFAULT_VZ });
                      setV({ rotate: 0 });
                    }}
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
                    <div>
                      <Group justify="space-between" mb={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          Rotate
                        </Text>
                        <Text size="xs" style={{ fontFamily: 'monospace' }}>
                          {vfx.rotate}&deg;
                        </Text>
                      </Group>
                      <GlassSegmented
                        value={String(vfx.rotate)}
                        onChange={(v) => setV({ rotate: Number(v) })}
                        data={[
                          { value: '0', label: '0\u00b0' },
                          { value: '90', label: '90\u00b0' },
                          { value: '180', label: '180\u00b0' },
                          { value: '270', label: '270\u00b0' }
                        ]}
                      />
                    </div>
                    {/* Shortcut hint, hidden from the UI on purpose (kept here for reference):
<Text size="10px" c="dimmed" style={{ lineHeight: 1.5 }}>
                      + / − zoom · [ vertical stretch · ] horizontal stretch (Shift to shrink) ·
                      Shift+W/A/S/D or right-click drag to move · Shift+scroll zooms at the
                      pointer. Zoom, move and stretch switch to Custom.
                    </Text>
                    */}
                  </EffectSection>

                  <Divider my={4} />

                  {/* Pitch, reverb + EQ. */}
                  <EffectSection
                    title="Audio Effects"
                    open={acc.isOpen('audio')}
                    onToggle={() => acc.toggle('audio')}
                    active={toneActive}
                    onReset={() => setAfx({ ...DEFAULT_AUDIO_FX })}
                  >
                    <Dim off={pitchOn}>
                      <FxSlider
                        label="Pitch"
                        display={`${afx.pitch > 0 ? '+' : ''}${afx.pitch} st`}
                        value={afx.pitch}
                        min={PITCH_MIN_ST}
                        max={PITCH_MAX_ST}
                        step={1}
                        color="violet"
                        onChange={(v) => setA({ pitch: v })}
                        marks={[{ value: 0 }]}
                      />
                    </Dim>
                    <Divider />
                    <ReverbControls wet={afx.reverbWet} onWet={(v) => setA({ reverbWet: v })} />
                    <Divider />
                    <EqControls
                      values={{ subBass: afx.subBass, bass: afx.bass, treble: afx.treble }}
                      onChange={(v) => setA(v)}
                    />
                  </EffectSection>
                </>
              )}
            />

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
              transitionProps={instantClose ? { duration: 0, exitDuration: 0 } : undefined}
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
                      <VolumeIcon pct={volumePct} muted={muted} size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Box>
              </Popover.Target>
              <Popover.Dropdown
                style={{ padding: '8px 12px' }}
                onWheel={onWheelAdjust((dir) => adjustVolumeRelative(dir * 5))}
              >
                <GlassScroll maxHeight={volumeMaxH - 20}>
                  <MediaMenuSections
                    subs={subs.map((s) => s.label)}
                    subIndex={subIndex}
                    onSubIndex={setSubIndex}
                    audioTracks={audioTracks}
                    onAudioTrack={selectAudioTrack}
                  />
                  <Divider my={8} />
                  <Dim off={volumeOn}>
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
                      <VolumeIcon pct={volumePct} muted={muted} size={14} />
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
                  </Dim>
                </GlassScroll>
              </Popover.Dropdown>
            </Popover>

            {/* Hidden in the mini player (the F key still goes fullscreen from mini). */}
            {!isMini && (
              <Tooltip
                label={isFullscreen ? 'Exit fullscreen (F / Esc)' : 'Fullscreen (F)'}
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
                  {isFullscreen ? (
                    <IconArrowsMinimize size={16} />
                  ) : (
                    <IconArrowsMaximize size={16} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          </div>

          {/* Eye (hide / show title bar) button from PreviewPane, only in compact mode */}
          <div className={VIDEO_COMPACT_BAR.revealClassName} style={{ marginLeft: 8 }}>
            {compactEndSlot}
          </div>
        </Group>
      </Card>
    </Box>
  );

  return (
    <Box
      ref={wrapperRef}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      onMouseMove={handlePlayerMouseMove}
      style={{
        height: '100%',
        width: '100%',
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        // Black in both themes (was var(--wh3d-viewport-bg), which is white in light mode).
        background: '#000'
      }}
    >
      <PlayerGlassStyles />
      <style>{videoCompactBarCss()}</style>

      {/* Video surface (overflow hidden so a zoomed picture is clipped to the player) */}
      <Box
        ref={surfaceRef}
        onMouseDown={handleSurfaceMouseDown}
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          setFxOpen(false);
          setVolumeOpen(false);
          openContextMenuAt(e);
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          // Leaves room for the control bar underneath; animates when the bar
          // collapses into the compact floating bar (and back).
          bottom: reservedBottom,
          transition: `bottom ${VIDEO_COMPACT_BAR.durationMs}ms ${VIDEO_COMPACT_BAR.cssEasing}`,
          minHeight: 0,
          background: '#000',
          overflow: 'hidden',
          // A drag on the picture is a gesture, never a text / image selection.
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          draggable={false}
          onClick={(e) => {
            // A drag up / down gesture just fired: that release is not a play / pause click.
            if (gesture.shouldSuppressClick()) return;
            if (e.shiftKey || shiftDragRef.current) return;
            // Own double-click check: two clicks only count when they are close in
            // time AND place, so a click a couple of seconds later is just a click.
            const now = performance.now();
            const last = lastClickRef.current;
            const isDouble =
              now - last.t < DOUBLE_CLICK_MS &&
              Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_CLICK_SLOP_PX;
            lastClickRef.current = isDouble
              ? { t: 0, x: 0, y: 0 }
              : { t: now, x: e.clientX, y: e.clientY };
            // A double-click puts play / pause back (no indicator) and does what the F key does.
            togglePlay(!isDouble);
            if (isDouble) {
              if (menusOpenRef.current) closeMenusNow();
              toggleFullscreen();
            }
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            setVideoSize({
              w: e.currentTarget.videoWidth || 0,
              h: e.currentTarget.videoHeight || 0
            });
            // Re-apply persisted settings after the element finishes loading.
            e.currentTarget.volume = Math.max(0, Math.min(1, volEff));
            e.currentTarget.muted = isMuted;
            e.currentTarget.preservesPitch = shiftSt === 0;
            e.currentTarget.playbackRate = effectiveRate(speedEff, shiftSt);
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
            // Starting from the beginning (or after it ended) = a new random roll.
            const vEl = videoRef.current;
            if (anyModular(modularRef.current) && (!vEl || vEl.currentTime < 0.25 || vEl.ended)) {
              rerollModular();
            }
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            const d = e.currentTarget.duration;
            // Wrapped around from the end back to the start (loop): new random roll.
            if (
              anyModular(modularRef.current) && e.currentTarget.loop &&
              Number.isFinite(d) &&
              lastTimeRef.current > t &&
              lastTimeRef.current > d - 0.6 &&
              t < 0.6
            ) {
              rerollModular();
            }
            lastTimeRef.current = t;
            if (!scrubbingRef.current) setCurrentTime(t);
          }}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: videoObjectFit,
            display: 'block',
            background: '#000',
            cursor: error ? 'default' : compact && !barShown ? 'none' : 'pointer',
            filter: videoFilter,
            transform: videoTransform,
            transformOrigin: '50% 50%'
          }}
        >
        </video>

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

        {/* Play / pause circle + status pill (shared with AudioPlayer) */}
        {subText && (
          <div
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              bottom: (overlayControls || compact ? 72 : 16) + subCfg.lift,
              textAlign: 'center',
              pointerEvents: 'none',
              zIndex: 1
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 6,
                background: subCfg.boxOn ? hexRgba(subCfg.box, subCfg.boxAlpha) : 'transparent',
                color: subCfg.color,
                fontFamily: resolveSubFont(subCfg.font, subText),
                unicodeBidi: 'plaintext',
                fontSize: `calc(clamp(14px, 2.2vw, 28px) * ${subCfg.size})`,
                lineHeight: 1.35,
                whiteSpace: 'pre-line',
                textShadow: subTextShadow(subCfg)
              }}
            >
              {subText}
            </span>
          </div>
        )}
        <PlaybackIndicators api={pi} />
      </Box>

      {/* Control bar. Always the same element (so its collapse animation can run):
          under the video by default, floating over it with overlayControls or in compact mode. */}
      {controlBar}

      {ctxMenu && (
        <PlayerContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          sections={[
            {
              id: 'ui',
              label: 'Interface',
              width: 220,
              content: (
                <Switch
                  size="xs"
                  label="Hide interface (O)"
                  checked={!!chromeHidden}
                  onChange={() => {
                    onToggleChrome?.();
                    setCtxMenu(null);
                  }}
                />
              )
            },
            {
              id: 'subs',
              label: 'Subtitles',
              content:
                subs.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No subtitle files found next to this video.
                  </Text>
                ) : (
                  <OptionList
                    items={[
                      { label: 'Off', checked: subIndex < 0 },
                      ...subs.map((s, i) => ({ label: s.label, checked: subIndex === i }))
                    ]}
                    onPick={(i) => {
                      setSubIndex(i - 1);
                      setCtxMenu(null);
                    }}
                  />
                )
            },
            {
              id: 'playback',
              label: 'Playback',
              width: 250,
              content: (
                <Stack gap={8}>
                  <Dim off={speedOn}>
                    <FxSlider
                      label="Speed"
                      display={`${speed}x`}
                      value={speed}
                      min={0.25}
                      max={4}
                      step={0.05}
                      onChange={(v) => setSpeed(Math.round(v * 100) / 100)}
                      marks={[{ value: 1 }]}
                    />
                  </Dim>
                  <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                    Modular (random each play / loop)
                  </Text>
                  <Switch
                    size="xs"
                    label="Modular pitch"
                    checked={modular.pitchOn}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setModular({ ...modular, pitchOn: v });
                    }}
                  />
                  <Switch
                    size="xs"
                    label="Modular speed"
                    checked={modular.speedOn}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setModular({ ...modular, speedOn: v });
                    }}
                  />
                  <Switch
                    size="xs"
                    label="Modular volume"
                    checked={modular.volumeOn}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setModular({ ...modular, volumeOn: v });
                    }}
                  />
                  <UnstyledButton
                    onClick={() => {
                      setSpeed(1);
                      setModular({ ...modular, pitchOn: false, speedOn: false, volumeOn: false });
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      Reset
                    </Text>
                  </UnstyledButton>
                </Stack>
              )
            },
            {
              id: 'subset',
              label: 'Subtitle Settings',
              width: 250,
              content: (
                <Stack gap={8}>
                  <FxSlider
                    label="Delay"
                    display={`${subCfg.delay > 0 ? '+' : ''}${subCfg.delay.toFixed(1)} s`}
                    value={subCfg.delay}
                    min={-10}
                    max={10}
                    step={0.1}
                    onChange={(v) => setSubCfg((p) => ({ ...p, delay: v }))}
                    marks={[{ value: 0 }]}
                  />
                  <FxSlider
                    label="Size"
                    display={`${Math.round(subCfg.size * 100)}%`}
                    value={subCfg.size}
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    onChange={(v) => setSubCfg((p) => ({ ...p, size: v }))}
                    marks={[{ value: 1 }]}
                  />
                  <FxSlider
                    label="Height"
                    display={`${subCfg.lift} px`}
                    value={subCfg.lift}
                    min={0}
                    max={300}
                    step={2}
                    onChange={(v) => setSubCfg((p) => ({ ...p, lift: v }))}
                    marks={[{ value: 0 }]}
                  />
                  <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                    Presets
                  </Text>
                  <OptionList
                    items={SUB_PRESETS.map((p) => ({ label: p.label, checked: false }))}
                    onPick={(i) => setSubCfg((c) => ({ ...c, ...SUB_PRESETS[i].cfg }))}
                  />
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      Text color
                    </Text>
                    <input
                      type="color"
                      value={subCfg.color}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setSubCfg((c) => ({ ...c, color: v }));
                      }}
                      style={{ width: 34, height: 22, border: 'none', background: 'none', padding: 0 }}
                    />
                  </Group>
                  <Switch
                    size="xs"
                    label="Background box"
                    checked={subCfg.boxOn}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setSubCfg((c) => ({ ...c, boxOn: v }));
                    }}
                  />
                  {subCfg.boxOn && (
                    <>
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          Box color
                        </Text>
                        <input
                          type="color"
                          value={subCfg.box}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            setSubCfg((c) => ({ ...c, box: v }));
                          }}
                          style={{ width: 34, height: 22, border: 'none', background: 'none', padding: 0 }}
                        />
                      </Group>
                      <FxSlider
                        label="Box opacity"
                        display={`${Math.round(subCfg.boxAlpha * 100)}%`}
                        value={subCfg.boxAlpha}
                        min={0.1}
                        max={1}
                        step={0.05}
                        onChange={(v) => setSubCfg((c) => ({ ...c, boxAlpha: v }))}
                        marks={[{ value: 0.55 }]}
                      />
                    </>
                  )}
                  <FxSlider
                    label="Outline"
                    display={`${subCfg.outline.toFixed(1)} px`}
                    value={subCfg.outline}
                    min={0}
                    max={4}
                    step={0.5}
                    onChange={(v) => setSubCfg((c) => ({ ...c, outline: v }))}
                    marks={[{ value: 0 }]}
                  />
                  <FxSlider
                    label="Drop shadow blur"
                    display={`${subCfg.shadow} px`}
                    value={subCfg.shadow}
                    min={0}
                    max={16}
                    step={1}
                    onChange={(v) => setSubCfg((c) => ({ ...c, shadow: v }))}
                    marks={[{ value: 0 }]}
                  />
                  <UnstyledButton onClick={() => setSubCfg({ ...DEFAULT_SUB })}>
                    <Text size="xs" c="dimmed">
                      Reset
                    </Text>
                  </UnstyledButton>
                </Stack>
              )
            },
            {
              id: 'subfont',
              label: 'Subtitle Font',
              width: 270,
              content: (
                <FontList
                  value={subCfg.font}
                  onChange={(f) => setSubCfg((c) => ({ ...c, font: f }))}
                />
              )
            },
{
              id: 'audio',
              label: 'Audio',
              content: (
                <Stack gap={8}>
                  {audioTracks.length > 1 && (
                    <>
                      <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                        Audio track
                      </Text>
                      <OptionList
                        items={audioTracks.map((t) => ({ label: t.label, checked: t.enabled }))}
                        onPick={(i) => {
                          selectAudioTrack(i);
                          setCtxMenu(null);
                        }}
                      />
                    </>
                  )}
                  <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                    Output device
                  </Text>
                  <OutputDeviceList onPicked={() => setCtxMenu(null)} />
                </Stack>
              )
            },
            {
              id: 'video',
              label: 'Video Effects',
              width: 250,
              content: (
                <Stack gap={8}>
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
                    display={`${vfx.hue > 0 ? '+' : ''}${vfx.hue}\u00b0`}
                    value={vfx.hue}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={(v) => setV({ hue: v })}
                    marks={[{ value: 0 }]}
                  />
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
                  <UnstyledButton onClick={() => setVfx((p) => ({ ...DEFAULT_VIDEO_FX, rotate: p.rotate }))}>
                    <Text size="xs" c="dimmed">
                      Reset
                    </Text>
                  </UnstyledButton>
                </Stack>
              )
            },
            {
              id: 'scale',
              label: 'Scale & Position',
              width: 250,
              content: (
                <Stack gap={10}>
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
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>
                      Rotate
                    </Text>
                    <GlassSegmented
                      value={String(vfx.rotate)}
                      onChange={(v) => setV({ rotate: Number(v) })}
                      data={[
                        { value: '0', label: '0\u00b0' },
                        { value: '90', label: '90\u00b0' },
                        { value: '180', label: '180\u00b0' },
                        { value: '270', label: '270\u00b0' }
                      ]}
                    />
                  </div>
                  <UnstyledButton
                    onClick={() => {
                      setVz({ ...DEFAULT_VZ });
                      setV({ rotate: 0 });
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      Reset
                    </Text>
                  </UnstyledButton>
                </Stack>
              )
            },
            {
              id: 'afx',
              label: 'Audio Effects',
              width: 250,
              content: (
                <Stack gap={8}>
                  <Dim off={pitchOn}>
                    <FxSlider
                      label="Pitch"
                      display={`${afx.pitch > 0 ? '+' : ''}${afx.pitch} st`}
                      value={afx.pitch}
                      min={PITCH_MIN_ST}
                      max={PITCH_MAX_ST}
                      step={1}
                      color="violet"
                      onChange={(v) => setA({ pitch: v })}
                      marks={[{ value: 0 }]}
                    />
                  </Dim>
                  <Divider />
                  <ReverbControls wet={afx.reverbWet} onWet={(v) => setA({ reverbWet: v })} />
                  <Divider />
                  <EqControls
                    values={{ subBass: afx.subBass, bass: afx.bass, treble: afx.treble }}
                    onChange={(v) => setA(v)}
                  />
                  <UnstyledButton onClick={() => setAfx({ ...DEFAULT_AUDIO_FX })}>
                    <Text size="xs" c="dimmed">
                      Reset
                    </Text>
                  </UnstyledButton>
                </Stack>
              )
            }
          ]}
        />
      )}

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
            Reset speed, volume, scale and position, and all video and audio effects back to defaults? (Loop stays as it is.)
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmResetOpen(false)}>
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