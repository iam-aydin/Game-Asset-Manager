import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PlayerGlassStyles, PLAYER_GLASS_CLASS, PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Image,
  Loader,
  Modal,
  Popover,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme
} from '@mantine/core';
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat
} from '@tabler/icons-react';
import { MiniIcon, MiniOffIcon } from './PlayerIcons';
import { MediaMenuSections, OutputDeviceList } from './PlayerMediaMenu';
import { PlayerContextMenu } from './PlayerContextMenu';
import { applyOutput, outputStore, useAudioOutput } from './audioOutput';
import type { CtxSnapshot } from './ContextMenuWindow';
import { VIDEO_COMPACT_BAR, videoCompactBarCss } from '@shared/transition';
import { useAutoHideBar } from '../util/autohide';
import { PlaybackIndicators, VolumeIcon, usePlaybackIndicators } from './PlaybackIndicators';
import {
  Dim,
  EffectSection,
  EqControls,
  FxSlider,
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
  sliderThumbStyle,
  useReverbParams,
  type PitchCorrector,
  type PitchMode,
  type ModularSettings,
  DEFAULT_MODULAR,
  anyModular,
  normalizeModular,
  rollModular
} from './playerShared';

interface AudioPlayerProps {
  libraryId: string;
  fileId: number;
  filename: string;
  coverUrl?: string; // Optional cover image URL or custom protocol path
  autoPlay?: boolean;
  /**
   * Visualizer "stage" layout.
   *  - 'above' (default): the player renders the visualizer itself, above the bar.
   *  - 'none': bar only, no visualizer.
   * Without `stageHeight` the player fills its parent: the stage takes the whole
   * area and the bar floats over the bottom of it (preview pane, Compare).
   */
  stage?: 'above' | 'none';
  /** Fixed stage height in px. The stage then sits in the normal flow above the bar. */
  stageHeight?: number;
  /** @deprecated Use `stage`. `showHero={false}` means `stage="none"`. */
  showHero?: boolean;
  /** @deprecated Use `stageHeight`. */
  heroHeight?: number;
  onMini?: () => void;
  isMini?: boolean;
  onFullscreen?: () => void;
  isFullscreen?: boolean;
  /**
   * When several players are on screen at once (Compare), the keyboard
   * shortcuts (Space, S, A, D, W, X, M, J, K, L, R) only reach the player whose
   * pane (the closest element with data-key-scope, else the player itself) the
   * pointer is over, instead of every player at the same time.
   */
  scopedKeys?: boolean;
  /** Mini player "hide interface" state (same as VideoPlayer). Pass true / false
   *  from PreviewPane; leave undefined (Compare view etc.) for the old layout. */
  compact?: boolean;
  /** Shown at the left / right end of the compact bar. Only rendered in compact mode. */
  compactStartSlot?: React.ReactNode;
  compactEndSlot?: React.ReactNode;
  /** Interface hidden (PreviewPane owns it). The right-click menu toggles it. */
  chromeHidden?: boolean;
  onToggleChrome?: () => void;
}

// CSS variables read by the collapse animation in transition.ts: the size the
// element collapses from, and its spacing (which collapses too).
const collapseVars = (max: string, mr = '0px', ml = '0px') =>
  ({
    '--gam-collapse-max': max,
    '--gam-collapse-mr': mr,
    '--gam-collapse-ml': ml
  }) as React.CSSProperties;

const VOLUME_MAX_PCT = 200;
const VOLUME_SNAP_LOW = 94;
const VOLUME_SNAP_HIGH = 125;

// Stage (visualizer) layout when it fills the parent.
const STAGE_INSET = 12; // px of space above / left / right of the visualizer
const STAGE_BAR_GAP = 8; // px between stage and bar when the bar has no padding of its own
const BAR_MAX_WIDTH = 640;
// Wheel: one mouse notch is ~100 delta; touchpads send many small ones.
const WHEEL_STEP_DELTA = 100;
const WHEEL_VOLUME_STEP = 5;
// A press that moves more than this is a drag, not a click.
const CLICK_SLOP_PX = 5;

const VIZ_FFT = 4096;
const WAVEFORM_BARS = 72;

// One back-to-back piece of a modular playback chain (see startPlayback).
interface ModIter {
  start: number; // AudioContext time this piece starts
  offset: number; // where in the file it starts
  dur: number; // how long it lasts, in AudioContext seconds
  rate: number; // effective file-seconds per second (speed * pitch)
  roll: { p: number; s: number; v: number; st: number }; // the random pitch / speed / volume it was given
  source: AudioBufferSourceNode;
}

let sharedAudioCtx: AudioContext | null = null;

const getSharedAudioContext = (): AudioContext => {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioCtx = new AudioCtxClass();
  }
  return sharedAudioCtx;
};

interface PersistedAudioEffects {
  speed: number;
  pitch: number; // semitones for whichever pitch mode is on
  pitchMode: PitchMode;
  reverbWet: number;
  subBass: number;
  bass: number;
  treble: number;
  isLooping: boolean;
  modular: ModularSettings;
  // Volume used to live only in component state, so it reset to 100% every
  // time the player remounted (switching tracks, reopening the app). It's
  // now part of the persisted blob like every other effect. Mute is kept
  // out on purpose — nobody wants the player to silently reopen muted.
  volume: number;
}

const DEFAULT_AUDIO_EFFECTS: PersistedAudioEffects = {
  speed: 1,
  pitch: 0,
  pitchMode: 'shift',
  reverbWet: 0,
  subBass: 0,
  bass: 0,
  treble: 0,
  isLooping: true,
  volume: 1,
  modular: { ...DEFAULT_MODULAR }
};

const STORAGE_KEY = 'wh3d_audio_player_effects';

const loadPersistedEffects = (): PersistedAudioEffects => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Pitch correction was removed: pitch always changes pitch AND speed together.
      parsed.pitchMode = 'shift';
      return { ...DEFAULT_AUDIO_EFFECTS, ...parsed, modular: normalizeModular(parsed.modular) };
    }
  } catch (e) {
    console.error('Failed to load audio effects from localStorage:', e);
  }
  return { ...DEFAULT_AUDIO_EFFECTS };
};

let persistedEffects: PersistedAudioEffects = loadPersistedEffects();

const audioEffectsStore = {
  get: (): PersistedAudioEffects => persistedEffects,
  set(partial: Partial<PersistedAudioEffects>) {
    persistedEffects = { ...persistedEffects, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedEffects));
    } catch (e) {
      console.error('Failed to save audio effects to localStorage:', e);
    }
  },
  reset(): PersistedAudioEffects {
    persistedEffects = { ...DEFAULT_AUDIO_EFFECTS };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedEffects));
    } catch (e) {
      console.error('Failed to reset audio effects in localStorage:', e);
    }
    return persistedEffects;
  }
};

interface AudioGraph {
  preamp: GainNode;
  sub: BiquadFilterNode;
  bass: BiquadFilterNode;
  treble: BiquadFilterNode;
  master: GainNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
  analyser: AnalyserNode;
  pitchFx: PitchCorrector;
}

const effectiveRate = (speed: number, pitchSemitones: number) =>
  speed * Math.pow(2, pitchSemitones / 12);

const getMonoChannelData = (buffer: AudioBuffer): Float32Array => {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
};

const computeWaveformPeaks = (buffer: AudioBuffer, numBars: number): number[] => {
  const data = getMonoChannelData(buffer);
  const blockSize = Math.max(1, Math.floor(data.length / numBars));
  const peaks: number[] = [];
  for (let i = 0; i < numBars; i++) {
    const start = i * blockSize;
    const end = i === numBars - 1 ? data.length : start + blockSize;
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const loudest = Math.max(...peaks, 0.0001);
  return peaks.map((p) => p / loudest);
};

function WaveformBars({ peaks, progress }: { peaks: number[]; progress: number }) {
  const playedCount = Math.round(progress * peaks.length);
  const barWidth = 100 / peaks.length;
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {peaks.map((p, i) => {
        const h = Math.max(p * 34, 2);
        const x = i * barWidth + barWidth * 0.15;
        const y = (40 - h) / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth * 0.7}
            height={h}
            rx={barWidth * 0.3}
            fill={
              i < playedCount
                ? 'var(--wh3d-waveform-played, #4c6ef5)'
                : 'var(--wh3d-waveform-unplayed, rgba(255,255,255,0.25))'
            }
          />
        );
      })}
    </svg>
  );
}

// ─── Windows media panel (quick settings / lock screen / media keys) ────────
// The player decodes audio with the Web Audio API, which Chromium does not
// report as "media playing". A silent looping <audio> element, started and
// stopped with the real playback, makes the OS media panel appear; the
// Media Session handlers below then route its buttons back to this player.
let silentWavUrl: string | null = null;
const getSilentWavUrl = (): string => {
  if (silentWavUrl) return silentWavUrl;
  const sampleRate = 8000;
  const samples = sampleRate; // 1 second
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples * 2, true);
  silentWavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentWavUrl;
};

// ─── Visualizer (canvas) ────────────────────────────────────────────────────
// Lives in this file; the player passes it its own analyser and play state.
const VIZ_MIN_HZ = 30;
const VIZ_MAX_HZ = 16000;
// Fallbacks match the dark theme. The active theme overrides them through
// --wh3d-viz-top / --wh3d-viz-mid (see dark.ts / light.ts).
const VIZ_TOP_FALLBACK = '#a5b4fc';
const VIZ_MID_FALLBACK = '#7c83f5';

function VisualizerCanvas({
  bars,
  analyser,
  isPlaying
}: {
  bars: number;
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}) {
  // Only here so the effect re-runs (and repaints the idle state) on theme change.
  const colorScheme = useComputedColorScheme('dark');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef(new Float32Array(bars));
  const dataRef = useRef(new Uint8Array(2048));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    if (barsRef.current.length !== bars) {
      barsRef.current = new Float32Array(bars);
    }

    // Draws one frame. Returns true while it still needs to keep animating.
    const draw = (): boolean => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (w === 0 || h === 0) return false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const c = canvas.getContext('2d');
      if (!c) return false;

      const values = barsRef.current;
      const live = isPlaying && !!analyser;

      let binHz = 1;
      if (live && analyser) {
        if (dataRef.current.length !== analyser.frequencyBinCount) {
          dataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(dataRef.current);
        binHz = analyser.context.sampleRate / analyser.fftSize;
      }
      const data = dataRef.current;
      const ratio = VIZ_MAX_HZ / VIZ_MIN_HZ;

      let animating = live;
      for (let i = 0; i < bars; i++) {
        let target = 0;
        if (live) {
          // Bars are spaced logarithmically so bass gets as much room as treble
          const f0 = VIZ_MIN_HZ * Math.pow(ratio, i / bars);
          const f1 = VIZ_MIN_HZ * Math.pow(ratio, (i + 1) / bars);
          const b0 = Math.floor(f0 / binHz);
          const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
          let sum = 0;
          let count = 0;
          for (let b = b0; b < b1 && b < data.length; b++) {
            sum += data[b];
            count++;
          }
          const raw = count ? sum / count / 255 : 0;
          target = Math.min(1, raw * (1 + (i / bars) * 0.8)); // slight tilt so highs stay visible
        }
        // Instant attack, smooth fall
        values[i] = Math.max(target, values[i] * 0.88);
        if (values[i] < 0.004) values[i] = 0;
        if (values[i] > 0) animating = true;
      }

      c.clearRect(0, 0, w, h);
      const gap = Math.max(2, Math.round(3 * dpr));
      const barW = (w - gap * (bars - 1)) / bars;
      const mid = h / 2;
      const maxHalf = mid - 2 * dpr;

      // Theme colors, read each frame so a theme switch shows up immediately.
      const styles = getComputedStyle(canvas);
      const vizTop = styles.getPropertyValue('--wh3d-viz-top').trim() || VIZ_TOP_FALLBACK;
      const vizMid = styles.getPropertyValue('--wh3d-viz-mid').trim() || VIZ_MID_FALLBACK;

      const grad = c.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, vizTop);
      grad.addColorStop(0.5, vizMid);
      grad.addColorStop(1, vizTop);
      c.fillStyle = grad;

      for (let i = 0; i < bars; i++) {
        const half = Math.max(dpr, values[i] * maxHalf);
        const x = i * (barW + gap);
        const y = mid - half;
        if (typeof c.roundRect === 'function') {
          c.beginPath();
          c.roundRect(x, y, barW, half * 2, Math.min(barW / 2, half));
          c.fill();
        } else {
          c.fillRect(x, y, barW, half * 2);
        }
      }

      return animating;
    };

    let frame: number | null = null;
    const loop = () => {
      frame = draw() ? requestAnimationFrame(loop) : null;
    };
    frame = requestAnimationFrame(loop);

    // Redraw the idle state when resized
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (frame === null) draw();
      });
      ro.observe(canvas);
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [analyser, isPlaying, bars, colorScheme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

export function AudioPlayer({
  libraryId,
  fileId,
  filename,
  coverUrl,
  autoPlay = false,
  stage,
  stageHeight,
  showHero,
  heroHeight,
  onMini,
  isMini,
  onFullscreen,
  isFullscreen,
  scopedKeys = false,
  compact,
  compactStartSlot,
  compactEndSlot,
  chromeHidden,
  onToggleChrome
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  // Published by the audio graph once a file has decoded; drives the stage canvas.
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPlay, setPendingPlay] = useState(autoPlay);
  const pendingPlayRef = useRef(autoPlay);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  // Was `useState(1)` — always reset to 100% on every mount. Now reads the
  // last saved value, same as speed/pitch/EQ/loop below.
  const [volume, setVolume] = useState(() => audioEffectsStore.get().volume);
  const [isMuted, setIsMuted] = useState(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  // The cover slot only exists once the image has actually loaded, so files
  // without embedded artwork render exactly as if the feature weren't there.
  const [coverReady, setCoverReady] = useState(false);
  const resolvedCoverUrl = coverUrl || `wh3d-cover://${libraryId}/${fileId}`;

  const [speed, setSpeed] = useState(() => audioEffectsStore.get().speed);
  const [pitchMode, setPitchMode] = useState<PitchMode>(() => audioEffectsStore.get().pitchMode);
  const [pitchSt, setPitchSt] = useState(() => audioEffectsStore.get().pitch);
  // Pitch shifter: pitch AND speed change together (tape-style).
  // Pitch correction: pitch changes, speed stays the same (the pitch node).
  const pitch = pitchMode !== 'correct' ? pitchSt : 0;
  const correctSt = pitchMode === 'correct' ? pitchSt : 0;
  const [reverbWet, setReverbWet] = useState(() => audioEffectsStore.get().reverbWet);
  const [subBass, setSubBass] = useState(() => audioEffectsStore.get().subBass);
  const [bass, setBass] = useState(() => audioEffectsStore.get().bass);
  const [treble, setTreble] = useState(() => audioEffectsStore.get().treble);
  const [isLooping, setIsLooping] = useState(() => audioEffectsStore.get().isLooping);
  const [modular, setModular] = useState<ModularSettings>(() => audioEffectsStore.get().modular);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Panel Popover States
  // One menu now holds speed, pitch, EQ and reverb.
  const [fxOpen, setFxOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const audioOut = useAudioOutput();
  useEffect(() => {
    void applyOutput(audioOut.deviceId, [audioCtxRef.current]);
  }, [audioOut.deviceId]);

  // ---- Stage layout ----
  // `showHero` / `heroHeight` still work: showHero={false} -> no stage.
  const hasStage = (stage ?? (showHero === false ? 'none' : 'above')) === 'above';
  const fixedStageH = stageHeight ?? heroHeight;
  // No fixed height: the player fills its parent and the bar floats over the stage.
  const fillStage = hasStage && fixedStageH === undefined;

  // ---- Play / pause circle + status pill (shared with VideoPlayer) ----
  // ONE instance, rendered once inside the stage.
  const pi = usePlaybackIndicators();
  // Latest values for fast wheel spins and for effects that must not re-run.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const volumeOpenRef = useRef(volumeOpen);
  volumeOpenRef.current = volumeOpen;

  // ---- Compact mode (mini player with the interface hidden) ----
  // Same behaviour as VideoPlayer: the bar collapses to just the seek slider,
  // floats over the visualizer, and auto-hides after 1 s without mouse movement.
  const compactAware = compact !== undefined;
  const isCompact = !!compact;
  const scrubbingRef = useRef(false);
  const scrubWasPlayingRef = useRef(false);
  const menusOpenRef = useRef(false);
  menusOpenRef.current = fxOpen || volumeOpen || confirmResetOpen || !!ctxMenu;

  const bar = useAutoHideBar({
    compact: isCompact,
    hideMs: VIDEO_COMPACT_BAR.autoHideMs,
    enterDelayMs: VIDEO_COMPACT_BAR.durationMs,
    isBusy: () => menusOpenRef.current || scrubbingRef.current
  });

  // A menu closing restarts the countdown.
  useEffect(() => {
    bar.rearm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxOpen, volumeOpen, confirmResetOpen]);

  // Any mouse movement anywhere brings the bar back.
  useEffect(() => {
    if (!isCompact) return undefined;
    window.addEventListener('mousemove', bar.poke);
    return () => window.removeEventListener('mousemove', bar.poke);
  }, [isCompact, bar.poke]);

  // Probe the cover off-screen first (window.Image, because Mantine's Image is
  // imported in this file). If it 404s — no embedded artwork — the slot never
  // renders, so there is no icon, no gap, and no layout shift.
  useEffect(() => {
    setCoverReady(false);
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      if (!cancelled) setCoverReady(true);
    };
    probe.onerror = () => {
      if (!cancelled) setCoverReady(false);
    };
    probe.src = resolvedCoverUrl;
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [resolvedCoverUrl]);

  // Refs for click outside & timer tracking
  const seekbarRef = useRef<HTMLDivElement | null>(null);
  const fxButtonRef = useRef<HTMLButtonElement | null>(null);
  const volumeButtonRef = useRef<HTMLButtonElement | null>(null);

  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoCloseTimer = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };

  const resetSeekbarTimer = () => {
    clearAutoCloseTimer();
    if (fxOpen || volumeOpen) {
      autoCloseTimerRef.current = setTimeout(() => {
        setFxOpen(false);
        setVolumeOpen(false);
      }, 7000);
    }
  };

  useEffect(() => {
    if (!fxOpen && !volumeOpen) return;

    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const popovers = document.querySelectorAll('.mantine-Popover-dropdown');
      for (const popover of Array.from(popovers)) {
        if (popover.contains(target)) return;
      }

      if (fxButtonRef.current?.contains(target) || volumeButtonRef.current?.contains(target)) {
        return;
      }

      if (seekbarRef.current?.contains(target)) {
        return;
      }

      clearAutoCloseTimer();
      setFxOpen(false);
      setVolumeOpen(false);
    };

    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
  }, [fxOpen, volumeOpen]);

  const toggleVolume = () => {
    clearAutoCloseTimer();
    setFxOpen(false);
    setVolumeOpen((prev) => !prev);
  };

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  useEffect(() => {
    return () => clearAutoCloseTimer();
  }, []);

  // I / F shortcuts: close the menus with no fade-out BEFORE the window resizes.
  const [instantClose, setInstantClose] = useState(false);
  const closeMenusNow = () => {
    clearAutoCloseTimer();
    flushSync(() => {
      setInstantClose(true);
      setFxOpen(false);
      setVolumeOpen(false);
    });
    requestAnimationFrame(() => setInstantClose(false));
  };

  // Safety net: a mode change from a button (not the keyboard) also closes the menus.
  useEffect(() => {
    setFxOpen(false);
    setVolumeOpen(false);
    setCtxMenu(null);
  }, [isMini, isFullscreen, compact]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);

  const positionRef = useRef<number>(0);
  const anchorRef = useRef<number>(0);
  const rateRef = useRef<number>(1);
  const isPlayingRef = useRef<boolean>(false);
  const animFrameRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The visualizer stage (click = play / pause, wheel = volume) and the bar wrapper.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const barWrapRef = useRef<HTMLDivElement | null>(null);

  // Room kept under the stage for the full-size bar (fill layout only). Ignored
  // while compact, so the stage grows into that space as the bar collapses.
  const [barH, setBarH] = useState(0);
  useLayoutEffect(() => {
    const el = barWrapRef.current;
    if (!el || !fillStage || isCompact) return undefined;
    const update = () => setBarH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillStage, isCompact]);

  // Modular playback: a chain of sources, each with its own random pitch + speed.
  const iterQueueRef = useRef<ModIter[]>([]);
  const modChainRef = useRef(false);
  const rollRef = useRef({ p: 1, s: 1, v: 1, st: 0 });

  const paramsRef = useRef({
    volume,
    isMuted,
    speed,
    pitch,
    correctSt,
    pitchSt,
    pitchCorrect: pitchMode === 'correct',
    modular,
    reverbWet,
    subBass,
    bass,
    treble,
    isLooping
  });
  paramsRef.current = {
    volume,
    isMuted,
    speed,
    pitch,
    correctSt,
    pitchSt,
    pitchCorrect: pitchMode === 'correct',
    modular,
    reverbWet,
    subBass,
    bass,
    treble,
    isLooping
  };

  const getPosition = () => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return positionRef.current;
    if (modChainRef.current) {
      const q = iterQueueRef.current;
      let it = q[0];
      for (const c of q) if (c.start <= ctx.currentTime) it = c;
      // Queue empty = the last piece finished (non-loop): report the end.
      if (!it) return audioBufferRef.current?.duration ?? positionRef.current;
      const mp = it.offset + Math.max(0, ctx.currentTime - it.start) * it.rate;
      const tot = audioBufferRef.current?.duration ?? 0;
      return tot > 0 ? Math.min(mp, tot) : mp;
    }
    const elapsed = (ctx.currentTime - anchorRef.current) * rateRef.current;
    const rawPos = positionRef.current + elapsed;
    const total = audioBufferRef.current?.duration ?? 0;

    if (total > 0 && paramsRef.current.isLooping) {
      return rawPos % total;
    }
    return rawPos;
  };

  const stopSource = (fadeSec = 0) => {
    if (iterQueueRef.current.length > 0) {
      const ctx0 = audioCtxRef.current;
      const fade =
        fadeSec > 0 && ctx0 && graphRef.current && isPlayingRef.current ? fadeSec : 0;
      for (const it of iterQueueRef.current) {
        const src0 = it.source;
        src0.onended = null;
        if (fade > 0 && ctx0) {
          try {
            src0.stop(ctx0.currentTime + fade);
          } catch {}
          setTimeout(() => {
            try {
              src0.disconnect();
            } catch {}
          }, fade * 1000 + 50);
        } else {
          try {
            src0.stop();
          } catch {}
          try {
            src0.disconnect();
          } catch {}
        }
      }
      iterQueueRef.current = [];
    }
    modChainRef.current = false;
    const s = sourceNodeRef.current;
    const ctx = audioCtxRef.current;
    const g = graphRef.current;

    if (!s) return;

    s.onended = null;

    if (fadeSec > 0 && ctx && g && isPlayingRef.current) {
      const now = ctx.currentTime;
      g.master.gain.cancelScheduledValues(now);
      g.master.gain.setValueAtTime(g.master.gain.value, now);
      g.master.gain.linearRampToValueAtTime(0.0001, now + fadeSec);

      try {
        s.stop(now + fadeSec);
      } catch {}

      const oldSource = s;
      setTimeout(() => {
        try {
          oldSource.disconnect();
        } catch {}
      }, fadeSec * 1000 + 50);
    } else {
      try {
        s.stop();
      } catch {}
      try {
        s.disconnect();
      } catch {}
    }

    sourceNodeRef.current = null;
  };

  const cancelFrame = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const applyParams = () => {
    const ctx = audioCtxRef.current;
    const g = graphRef.current;
    if (!ctx || !g) return;
    const p = paramsRef.current;
    const t = ctx.currentTime;

    g.master.gain.cancelScheduledValues(t);
    g.master.gain.setTargetAtTime(p.isMuted ? 0 : p.modular.volumeOn ? 1 : p.volume, t, 0.01);
    g.dry.gain.setTargetAtTime(1 - p.reverbWet, t, 0.01);
    g.wet.gain.setTargetAtTime(p.reverbWet, t, 0.01);

    g.sub.gain.setTargetAtTime(p.subBass, t, 0.02);
    g.bass.gain.setTargetAtTime(p.bass, t, 0.02);
    g.treble.gain.setTargetAtTime(p.treble, t, 0.02);
    g.pitchFx.setSemitones(
      p.modular.pitchOn ? 0 : p.pitchCorrect ? p.pitchSt : 0
    );

    const maxBoost = Math.max(0, p.subBass, p.bass, p.treble);
    g.preamp.gain.setTargetAtTime(Math.pow(10, -(maxBoost * EQ_HEADROOM) / 20), t, 0.02);
  };

  const buildGraph = (ctx: AudioContext): AudioGraph => {
    const preamp = ctx.createGain();
    const pitchFx = createPitchCorrector(ctx);

    const sub = ctx.createBiquadFilter();
    sub.type = 'lowshelf';
    sub.frequency.value = 60;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'peaking';
    bassFilter.frequency.value = 150;
    bassFilter.Q.value = 0.9;

    const trebleFilter = ctx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 6000;

    const master = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = VIZ_FFT;
    analyser.smoothingTimeConstant = 0.75;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -15;
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, fxPresetsStore.reverbParams());

    preamp.connect(pitchFx.input);
    pitchFx.output.connect(sub);
    sub.connect(bassFilter);
    bassFilter.connect(trebleFilter);
    trebleFilter.connect(master);
    trebleFilter.connect(analyser);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);

    master.connect(dry);
    dry.connect(limiter);
    master.connect(convolver);
    convolver.connect(wet);
    wet.connect(limiter);

    return {
      preamp,
      sub,
      bass: bassFilter,
      treble: trebleFilter,
      master,
      dry,
      wet,
      convolver,
      analyser,
      pitchFx
    };
  };

  useEffect(() => {
    let active = true;
    const fileUrl = `wh3d-file://${libraryId}/${fileId}`;

    cancelFrame();
    stopSource(0);
    isPlayingRef.current = false;
    positionRef.current = 0;
    audioBufferRef.current = null;
    graphRef.current?.pitchFx.dispose();
    graphRef.current = null;
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsLoading(true);
    setWaveformPeaks([]);

    pendingPlayRef.current = autoPlay;
    setPendingPlay(autoPlay);

    setAnalyser(null);

    const loadAudio = async () => {
      try {
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();

        const ctx = getSharedAudioContext();
        audioCtxRef.current = ctx;
        void applyOutput(outputStore.get(), [ctx]);

        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (!active) return;

        audioBufferRef.current = decodedBuffer;
        const graph = buildGraph(ctx);
        graphRef.current = graph;
        setAnalyser(graph.analyser);
        applyParams();

        setDuration(decodedBuffer.duration);
        setWaveformPeaks(computeWaveformPeaks(decodedBuffer, WAVEFORM_BARS));
        positionRef.current = 0;
        isPlayingRef.current = false;
        setCurrentTime(0);
        setIsPlaying(false);
        setIsLoading(false);

        if (pendingPlayRef.current) {
          pendingPlayRef.current = false;
          setPendingPlay(false);
          await startPlayback(0, true);
        }
      } catch (err) {
        console.error('Failed to load or decode audio file:', err);
        if (!active) return;
        setIsLoading(false);
        pendingPlayRef.current = false;
        setPendingPlay(false);
      }
    };

    void loadAudio();

    return () => {
      active = false;
      cancelFrame();
      stopSource(0.25);
      isPlayingRef.current = false;
      graphRef.current?.pitchFx.dispose();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, fileId, autoPlay]);

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

  const tick = () => {
    if (!isPlayingRef.current) return;
    const total = audioBufferRef.current?.duration ?? 0;
    const pos = getPosition();

    if (!paramsRef.current.isLooping && pos >= total) {
      stopSource(0.05);
      isPlayingRef.current = false;
      positionRef.current = 0;
      animFrameRef.current = null;
      setCurrentTime(total);
      setIsPlaying(false);
      return;
    }

    setCurrentTime(pos);
    animFrameRef.current = requestAnimationFrame(tick);
  };

  // ---- Modular pitch / volume / speed ----------------------------------------
  // The sound plays as a chain of back-to-back sources (gapless, scheduled on the
  // audio clock). Each piece gets its own random pitch / volume / speed. A modular
  // option replaces the regular control while it is on.
  const rollNow = () => {
    const r = rollModular(paramsRef.current.modular);
    return { p: r.p, s: r.s, v: r.v, st: 12 * Math.log2(r.p) };
  };

  const iterParams = (roll: { p: number; s: number; v: number; st: number }) => {
    const p = paramsRef.current;
    const m = p.modular;
    const baseSt = m.pitchOn ? roll.st : p.pitchSt;
    // Modular pitch is never corrected (it sounds robotic); otherwise the checkbox decides.
    const corrOn = !m.pitchOn && p.pitchCorrect;
    const shiftSt = corrOn ? 0 : baseSt;
    const spd = m.speedOn ? roll.s : p.speed;
    return {
      srcRate: spd,
      detune: shiftSt * 100,
      effRate: effectiveRate(spd, shiftSt),
      gain: m.volumeOn ? roll.v : 1
    };
  };

  const scheduleIter = (
    ctx: AudioContext,
    buffer: AudioBuffer,
    graph: AudioGraph,
    startAt: number,
    offset: number,
    roll: { p: number; s: number; v: number; st: number }
  ): ModIter => {
    const ip = iterParams(roll);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = ip.srcRate;
    src.detune.value = ip.detune;
    src.loop = false;
    // Per-piece gain = the random volume (the master gain keeps the regular volume).
    const g = ctx.createGain();
    g.gain.value = ip.gain;
    src.connect(g);
    g.connect(graph.preamp);
    src.addEventListener('ended', () => {
      try {
        g.disconnect();
      } catch {}
    });
    src.start(startAt, offset);
    const it: ModIter = {
      start: startAt,
      offset,
      dur: Math.max(0.01, (buffer.duration - offset) / ip.effRate),
      rate: ip.effRate,
      roll,
      source: src
    };
    iterQueueRef.current.push(it);
    return it;
  };

  // A piece finished: the next one is already playing. Make it the current roll
  // and schedule one more behind it (when looping).
  const onIterEnded = (it: ModIter) => {
    const q = iterQueueRef.current;
    const idx = q.indexOf(it);
    if (idx === -1) return;
    q.splice(idx, 1);
    const ctx = audioCtxRef.current;
    const buffer = audioBufferRef.current;
    const graph = graphRef.current;
    if (!ctx || !buffer || !graph || !isPlayingRef.current || !modChainRef.current) return;
    while (paramsRef.current.isLooping && q.length < 2) {
      const last = q[q.length - 1];
      const startAt = Math.max(ctx.currentTime, last ? last.start + last.dur : ctx.currentTime);
      const next = scheduleIter(ctx, buffer, graph, startAt, 0, rollNow());
      next.source.onended = () => onIterEnded(next);
      sourceNodeRef.current = next.source;
    }
    const cur = q[0];
    if (cur) {
      rollRef.current = cur.roll;
      applyParams();
    }
  };

  const startPlayback = async (offset: number, reroll = false) => {
    const ctx = audioCtxRef.current;
    const buffer = audioBufferRef.current;
    const graph = graphRef.current;
    if (!ctx || !buffer || !graph) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.error('Failed to resume AudioContext:', e);
      }
    }

    stopSource(0.05);
    cancelFrame();

    applyParams();

    if (anyModular(paramsRef.current.modular)) {
      if (reroll) rollRef.current = rollNow();
      applyParams();
      modChainRef.current = true;
      const first = scheduleIter(ctx, buffer, graph, ctx.currentTime, offset, rollRef.current);
      first.source.onended = () => onIterEnded(first);
      sourceNodeRef.current = first.source;
      if (paramsRef.current.isLooping) {
        const second = scheduleIter(ctx, buffer, graph, first.start + first.dur, 0, rollNow());
        second.source.onended = () => onIterEnded(second);
      }
      rateRef.current = first.rate;
      positionRef.current = offset;
      anchorRef.current = ctx.currentTime;
      isPlayingRef.current = true;
      setIsPlaying(true);
      animFrameRef.current = requestAnimationFrame(tick);
      return;
    }
    modChainRef.current = false;

    const { speed: s, pitch: p, isLooping: loop } = paramsRef.current;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.detune.value = p * 100;
    source.playbackRate.value = s;
    source.loop = loop;

    source.connect(graph.preamp);
    sourceNodeRef.current = source;

    rateRef.current = effectiveRate(s, p);
    positionRef.current = offset;
    anchorRef.current = ctx.currentTime;
    isPlayingRef.current = true;

    source.start(0, offset);
    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const pausePlayback = () => {
    const pos = getPosition();
    stopSource(0.2);
    cancelFrame();
    isPlayingRef.current = false;
    positionRef.current = pos;
    setCurrentTime(pos);
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }

    if (!audioBufferRef.current || !graphRef.current || isLoading) {
      const next = !pendingPlayRef.current;
      pendingPlayRef.current = next;
      setPendingPlay(next);
      pi.flashIndicator(next ? 'play' : 'pause');
      return;
    }

    if (isPlayingRef.current) {
      pausePlayback();
      pi.flashIndicator('pause');
    } else {
      const total = audioBufferRef.current?.duration ?? 0;
      if (positionRef.current >= total) {
        positionRef.current = 0;
      }
      void startPlayback(positionRef.current, true);
      pi.flashIndicator('play');
    }
  };

  const handleSeek = (val: number) => {
    resetSeekbarTimer();
    positionRef.current = val;
    setCurrentTime(val);
    if (isPlayingRef.current) {
      void startPlayback(val);
    }
  };

  const seekRelative = (direction: -1 | 1) => {
    const total = audioBufferRef.current?.duration || duration || 0;
    if (total <= 0) return;

    const step = total < 5 ? 1 : 5;
    const currentPos = getPosition();
    const targetPos = Math.max(0, Math.min(total, currentPos + direction * step));
    handleSeek(targetPos);
    pi.flashHud({
      kind: direction === -1 ? 'back' : 'forward',
      text: `${direction === -1 ? '−' : '+'}${step}s`
    });
  };

  // Reads a ref so fast wheel spins never use a stale volume. When the volume
  // actually changes, the status pill comes from the volume effect below; when
  // it is already at an end, hitLimit() drives the shake / shrink reaction.
  const adjustVolumeRelative = (deltaPct: number) => {
    const cur = Math.round(volumeRef.current * 100);
    const pct = Math.max(0, Math.min(VOLUME_MAX_PCT, cur + deltaPct));
    if (pct === cur) {
      if (!volumeOpenRef.current) {
        if (deltaPct > 0 && cur >= VOLUME_MAX_PCT) {
          pi.hitLimit('volume', 'max', {
            kind: 'volume',
            text: `${VOLUME_MAX_PCT}%`,
            pct: VOLUME_MAX_PCT,
            boosted: true
          });
        } else if (deltaPct < 0 && cur <= 0) {
          pi.hitLimit('volume', 'min', { kind: 'volume', text: '0%', pct: 0 });
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

    // Already at the fastest / slowest preset: pill reacts instead.
    if (direction === 'up' && closestIdx === SPEED_PRESETS.length - 1) {
      pi.hitLimit('speed', 'max', { kind: 'speed', text: `${speed}x` });
      return;
    }
    if (direction === 'down' && closestIdx === 0) {
      pi.hitLimit('speed', 'min', { kind: 'speed', text: `${speed}x` });
      return;
    }

    setSpeed(
      SPEED_PRESETS[
        direction === 'down'
          ? Math.max(0, closestIdx - 1)
          : Math.min(SPEED_PRESETS.length - 1, closestIdx + 1)
      ]
    );
  };

  // Windows-style hover-to-scroll: each control reacts to the wheel only
  // while the pointer is actually over that control (that's just what
  // onWheel already means), instead of the old global "scroll anywhere
  // changes volume" behavior. dir is +1 for scroll-up/forward and -1 for
  // scroll-down/back, matching how the Windows volume flyout behaves.
  const onWheelAdjust = (adjust: (dir: 1 | -1) => void) => (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) adjust(1);
    else if (e.deltaY > 0) adjust(-1);
  };

  useEffect(() => {
    if (sourceNodeRef.current && !modChainRef.current) {
      sourceNodeRef.current.loop = isLooping;
    }
    audioEffectsStore.set({ isLooping });
  }, [isLooping]);

  useEffect(() => {
    applyParams();
    // Volume now saves alongside the other effects — see
    // PersistedAudioEffects above. isMuted intentionally stays local/session
    // only.
    audioEffectsStore.set({ volume, reverbWet, subBass, bass, treble });
  }, [volume, isMuted, reverbWet, subBass, bass, treble, correctSt]);

  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (ctx && isPlayingRef.current) {
      positionRef.current = getPosition();
      anchorRef.current = ctx.currentTime;
    }
    rateRef.current = effectiveRate(speed, pitch);

    const src = sourceNodeRef.current;
    if (modChainRef.current && ctx && isPlayingRef.current) {
      // Modular chain: the pieces were scheduled with the old values, so restart from here.
      void startPlayback(getPosition());
    } else if (src && ctx && isPlayingRef.current) {
      src.playbackRate.setValueAtTime(speed, ctx.currentTime);
      src.detune.setValueAtTime(pitch * 100, ctx.currentTime);
    }

    audioEffectsStore.set({ speed });
  }, [speed, pitch]);

  useEffect(() => {
    audioEffectsStore.set({ pitch: pitchSt, pitchMode });
  }, [pitchSt, pitchMode]);

  useEffect(() => {
    audioEffectsStore.set({ modular });
  }, [modular]);

  // Turning modular on / off (or flipping pitch correction while it is on) restarts
  // the sound from where it is, so the change is heard right away.
  useEffect(() => {
    const anyMod = anyModular(modular);
    if (isPlayingRef.current && (modChainRef.current || anyMod)) {
      void startPlayback(getPosition(), anyMod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modular.pitchOn, modular.volumeOn, modular.speedOn, pitchMode]);

  // ---- Status pill: shows whenever speed / loop / volume / mute CHANGES, no
  // matter where the change came from (keyboard, menu, scroll, slider). Each
  // effect compares against the previous value, so the first render never
  // shows the pill.
  const prevSpeedRef = useRef(speed);
  useEffect(() => {
    if (prevSpeedRef.current === speed) return;
    prevSpeedRef.current = speed;
    pi.flashHud({ kind: 'speed', text: `${speed}x` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  const prevLoopRef = useRef(isLooping);
  useEffect(() => {
    if (prevLoopRef.current === isLooping) return;
    prevLoopRef.current = isLooping;
    pi.flashHud({ kind: isLooping ? 'loop-on' : 'loop-off', text: isLooping ? 'Loop on' : 'Loop off' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLooping]);

  const prevShownVolRef = useRef(isMuted ? 0 : volume);
  useEffect(() => {
    const shown = isMuted ? 0 : volume;
    if (prevShownVolRef.current === shown) return;
    prevShownVolRef.current = shown;
    // The volume popover has its own slider, so no pill while it is open.
    if (volumeOpenRef.current) return;
    const pct = Math.round(shown * 100);
    pi.flashHud({
      kind: 'volume',
      text: shown === 0 ? 'Muted' : `${pct}%`,
      pct,
      boosted: shown > 1
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, isMuted]);

  const formatTime = (timeSec: number) => {
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const scopedKeysRef = useRef(scopedKeys);
  scopedKeysRef.current = scopedKeys;

  const keyboardActionsRef = useRef({
    togglePlay,
    seekRelative,
    adjustVolumeRelative,
    changeSpeedStep,
    setConfirmResetOpen,
    toggleMute
  });

  useEffect(() => {
    keyboardActionsRef.current = {
      togglePlay,
      seekRelative,
      adjustVolumeRelative,
      changeSpeedStep,
      setConfirmResetOpen,
      toggleMute
    };
  });

  // Scroll wheel over the STAGE = volume in 5% steps, same as hovering the
  // video in VideoPlayer. The control bar is a sibling of the stage, so its
  // per-button wheel behaviour is untouched. Native non-passive listener so
  // preventDefault works.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    let acc = 0; // touchpads send many tiny deltas; a mouse notch is ~100
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[data-vp-controls]')) return;
      e.preventDefault();
      e.stopPropagation();
      acc += e.deltaY;
      const steps = Math.trunc(Math.abs(acc) / WHEEL_STEP_DELTA);
      if (steps === 0) return;
      const dir = acc < 0 ? 1 : -1; // scroll up = louder
      acc -= Math.sign(acc) * steps * WHEEL_STEP_DELTA;
      keyboardActionsRef.current.adjustVolumeRelative(dir * steps * WHEEL_VOLUME_STEP);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasStage]);

  // Left click on the stage = play / pause. A press that travelled (a drag,
  // like the preview's up / down gesture) is not a click.
  const stageDownRef = useRef<{ x: number; y: number } | null>(null);
  const handleStageMouseDown = (e: React.MouseEvent) => {
    stageDownRef.current = { x: e.clientX, y: e.clientY };
  };
  const handleStageClick = (e: React.MouseEvent) => {
    const d = stageDownRef.current;
    stageDownRef.current = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
    keyboardActionsRef.current.togglePlay();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        target &&
        (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }

      if (scopedKeysRef.current) {
        const root = rootRef.current;
        const scope = (root?.closest('[data-key-scope]') as HTMLElement | null) ?? root;
        const active = document.activeElement;
        const mine = !!scope && (scope.matches(':hover') || (!!active && scope.contains(active)));
        if (!mine) return;
      }

      const key = e.key.toLowerCase();

      // I (mini / compact) and F (fullscreen): close any open menu first.
      if (
        (key === 'i' || key === 'f') &&
        !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
        menusOpenRef.current
      ) {
        closeMenusNow();
      }

      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        keyboardActionsRef.current.togglePlay();
      } else if (key === 'a') {
        e.preventDefault();
        keyboardActionsRef.current.seekRelative(-1);
      } else if (key === 'd') {
        e.preventDefault();
        keyboardActionsRef.current.seekRelative(1);
      } else if (key === 's') {
        e.preventDefault();
        keyboardActionsRef.current.togglePlay();
      } else if (key === 'w') {
        e.preventDefault();
        keyboardActionsRef.current.adjustVolumeRelative(5);
      } else if (key === 'x') {
        e.preventDefault();
        keyboardActionsRef.current.adjustVolumeRelative(-5);
      } else if (key === 'm') {
        e.preventDefault();
        keyboardActionsRef.current.toggleMute();
      } else if (key === 'j') {
        e.preventDefault();
        keyboardActionsRef.current.changeSpeedStep('down');
      } else if (key === 'l') {
        e.preventDefault();
        keyboardActionsRef.current.changeSpeedStep('up');
      } else if (key === 'k') {
        e.preventDefault();
        keyboardActionsRef.current.changeSpeedStep('reset');
      } else if (key === 'r') {
        e.preventDefault();
        keyboardActionsRef.current.setConfirmResetOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      setConfirmResetOpen(true);
    }
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  const confirmResetEffects = () => {
    const defaults = audioEffectsStore.reset();
    setSpeed(defaults.speed);
    setPitchMode('shift');
    setPitchSt(0);
    setReverbWet(defaults.reverbWet);
    setSubBass(defaults.subBass);
    setBass(defaults.bass);
    setTreble(defaults.treble);
    setIsLooping(defaults.isLooping);
    setModular({ ...defaults.modular });
    setVolume(defaults.volume);
    setIsMuted(false);
    setConfirmResetOpen(false);
    // The speed/loop/volume effects above each flash their own pill after the
    // next render; this later call replaces them with a single "reset" pill.
    window.setTimeout(() => pi.flashHud({ kind: 'reset', text: 'Settings reset' }), 60);
  };

  // ── OS media panel integration ────────────────────────────────────────────
  const mediaActionsRef = useRef({ togglePlay, seekRelative, handleSeek });
  mediaActionsRef.current = { togglePlay, seekRelative, handleSeek };
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Title + artwork shown in the panel.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: filename,
        artist: 'Game Asset Manager',
        artwork: coverReady ? [{ src: resolvedCoverUrl }] : []
      });
    } catch {
      /* MediaMetadata unsupported: ignore */
    }
  }, [filename, coverReady, resolvedCoverUrl]);

  // Silent element mirrors play / pause so the OS sees "media is playing".
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    let a = silentAudioRef.current;
    if (!a) {
      a = new Audio(getSilentWavUrl());
      a.loop = true;
      a.volume = 0.01;
      silentAudioRef.current = a;
    }
    if (isPlaying) {
      void a.play().catch(() => {});
      navigator.mediaSession.playbackState = 'playing';
    } else {
      a.pause();
      navigator.mediaSession.playbackState = 'paused';
    }
  }, [isPlaying]);

  // Timeline in the panel.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: speed
      });
    } catch {
      /* invalid state: ignore */
    }
    // Only on play state / track / speed changes; ticking it every frame is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, duration, speed]);

  // Buttons in the panel -> this player.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported: ignore */
      }
    };
    set('play', () => {
      if (!isPlayingRef.current) mediaActionsRef.current.togglePlay();
    });
    set('pause', () => {
      if (isPlayingRef.current) mediaActionsRef.current.togglePlay();
    });
    set('seekbackward', () => mediaActionsRef.current.seekRelative(-1));
    set('seekforward', () => mediaActionsRef.current.seekRelative(1));
    set('seekto', (d) => {
      if (typeof d.seekTime === 'number') mediaActionsRef.current.handleSeek(d.seekTime);
    });
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as const) {
        set(a, null);
      }
      silentAudioRef.current?.pause();
      silentAudioRef.current = null;
      try {
        ms.metadata = null;
        ms.playbackState = 'none';
      } catch {
        /* ignore */
      }
    };
  }, []);

  const volumePct = Math.round((isMuted ? 0 : volume) * 100);
  const boosted = !isMuted && volume > 1;

  const handleVolumeChange = (pct: number) => {
    setIsMuted(false);
    const locked = pct >= VOLUME_SNAP_LOW && pct <= VOLUME_SNAP_HIGH ? 100 : pct;
    setVolume(locked / 100);
  };

  const resetVolume = () => {
    setIsMuted(false);
    setVolume(1);
  };

  const eqActive = subBass !== 0 || bass !== 0 || treble !== 0;

  const resetEq = () => {
    setSubBass(0);
    setBass(0);
    setTreble(0);
  };

  // ---- Right-click menu in its own window (mini player only) ----
  // The mini window is smaller than the menu, so there it is drawn by a separate window
  // (ContextMenuWindow.tsx, src/main/ipc/context-menu.ts) that sends its changes back here.
  const ctxOwnerRef = useRef(false);
  const ctxActionRef = useRef<(a: any) => void>(() => undefined);
  ctxActionRef.current = (a: any) => {
    if (a.op === 'chrome') {
      onToggleChrome?.();
    } else if (a.op === 'output') {
      outputStore.set(a.id);
    } else if (a.op === 'afxReset') {
      setPitchSt(0);
      setReverbWet(0);
      resetEq();
    } else if (a.op === 'afx') {
      const p = a.partial ?? {};
      if (typeof p.pitch === 'number') setPitchSt(p.pitch);
      if (typeof p.reverbWet === 'number') setReverbWet(p.reverbWet);
      if (typeof p.subBass === 'number') setSubBass(p.subBass);
      if (typeof p.bass === 'number') setBass(p.bass);
      if (typeof p.treble === 'number') setTreble(p.treble);
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
        kind: 'audio',
        chromeHidden: !!chromeHidden,
        subs: [],
        subIndex: -1,
        tracks: [],
        afx: { pitch: pitchSt, reverbWet, subBass, bass, treble },
        pitchOn: modular.pitchOn,
        defaults: { afx: { pitch: 0, reverbWet: 0, subBass: 0, bass: 0, treble: 0 } }
      };
      void g.openContextMenu({ x: ev.screenX, y: ev.screenY, state: snap });
      return;
    }
    setCtxMenu({ x: ev.clientX, y: ev.clientY });
  };

  // Visualizer stage. It owns click, wheel and the ONE set of indicators.
  // Fill layout: absolutely positioned, leaving room for the bar underneath
  // (all of it while compact, so it grows as the bar collapses).
  // Fixed layout: a normal block of `fixedStageH` px above the bar.
  const stageStyle: React.CSSProperties = fillStage
    ? {
        position: 'absolute',
        top: STAGE_INSET,
        left: STAGE_INSET,
        right: STAGE_INSET,
        bottom: isCompact ? 0 : barH + (compactAware ? 0 : STAGE_BAR_GAP),
        transition: `bottom ${VIDEO_COMPACT_BAR.durationMs}ms ${VIDEO_COMPACT_BAR.cssEasing}`,
        cursor: 'pointer'
      }
    : {
        position: 'relative',
        height: fixedStageH,
        marginBottom: 10,
        cursor: 'pointer'
      };

  const stageNode = hasStage ? (
    <div
      ref={stageRef}
      onMouseDown={handleStageMouseDown}
      onClick={handleStageClick}
      onContextMenu={(e) => {
        // GAM-RCLICK2: right-click opens the player's own context menu
        e.preventDefault();
        setFxOpen(false);
        setVolumeOpen(false);
        openContextMenuAt(e);
      }}
      style={stageStyle}
    >
      <VisualizerCanvas bars={44} analyser={analyser} isPlaying={isPlaying} />
      <PlaybackIndicators api={pi} />
    </div>
  ) : null;

  const barNode = (
    <>
      <style>{videoCompactBarCss()}</style>
      <Box
        p={compactAware ? 'xs' : 0}
        data-vp-controls
        data-compact={isCompact ? 'true' : 'false'}
        data-shown={bar.shown ? 'true' : 'false'}
        className={VIDEO_COMPACT_BAR.boxClassName}
        onMouseEnter={bar.onMouseEnter}
        onMouseLeave={bar.onMouseLeave}
      >
      <Card
        withBorder={false}
        radius="lg"
        p="xs"
        className={`${PLAYER_GLASS_CLASS} ${VIDEO_COMPACT_BAR.barClassName}`}
        data-compact={isCompact ? 'true' : 'false'}
        style={{ width: '100%' }}
      >
        <Group wrap="nowrap" gap={0} align="center">
          {/* Start slot (compact mode only) */}
          <div className={VIDEO_COMPACT_BAR.revealClassName} style={{ marginRight: 8 }}>
            {compactStartSlot}
          </div>
          {/* Cover art — only rendered when the file actually has embedded artwork */}
          {coverReady && (
            <div
              className={VIDEO_COMPACT_BAR.collapseClassName}
              style={{ flexShrink: 0, ...collapseVars('42px', '16px') }}
            >
              <Box
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid var(--mantine-color-dark-4)'
                }}
              >
                <Image src={resolvedCoverUrl} w={42} h={42} fit="cover" alt={filename} />
              </Box>
            </div>
          )}

          {/* Play Button */}
          <div
            className={VIDEO_COMPACT_BAR.collapseClassName}
            style={{ flexShrink: 0, ...collapseVars('56px', '16px') }}
          >
          <ActionIcon
            variant="filled"
            color="indigo"
            radius="xl"
            size={42}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{ flexShrink: 0 }}
          >
            {isLoading ? (
              pendingPlay ? (
                <Loader size={16} color="white" />
              ) : (
                <IconPlayerPlay size={20} style={{ marginLeft: 2 }} />
              )
            ) : isPlaying ? (
              <IconPlayerPause size={20} />
            ) : (
              <IconPlayerPlay size={20} style={{ marginLeft: 2 }} />
            )}
          </ActionIcon>
          </div>

          {/* File Name & Time Counter */}
          <Box
            className={VIDEO_COMPACT_BAR.collapseClassName}
            style={{ flexShrink: 1, flexGrow: 0, minWidth: 0, overflow: 'hidden', ...collapseVars('180px', '16px') }}
          >
            <Text size="xs" fw={700} truncate>
              {filename}
            </Text>
            <Text size="10px" c="dimmed" style={{ fontFamily: 'monospace' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </Box>

          {/* Center: Waveform + Interactive Seekbar */}
          <Box
            ref={seekbarRef}
            className="gam-vp-seek"
            onMouseDown={resetSeekbarTimer}
            style={{
              flex: '1 1 140px',
              minWidth: 140,
              position: 'relative',
              height: 40,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {waveformPeaks.length > 0 && (
              <Box
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  opacity: isCompact ? 0 : 1,
                  transition: 'opacity 300ms ease'
                }}
              >
                <WaveformBars peaks={waveformPeaks} progress={duration ? currentTime / duration : 0} />
              </Box>
            )}
            <Slider
              size="sm"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(val) => {
                if (!scrubbingRef.current) {
                  scrubbingRef.current = true;
                  scrubWasPlayingRef.current = isPlayingRef.current;
                  if (isPlayingRef.current) {
                    // Silence the sound while the knob is held (no harsh scratching).
                    const here = getPosition();
                    stopSource(0.03);
                    cancelFrame();
                    isPlayingRef.current = false;
                    positionRef.current = here;
                  }
                }
                resetSeekbarTimer();
                positionRef.current = val;
                setCurrentTime(val);
                // Show where the click / drag landed (e.g. 1:32) in the status pill.
                pi.flashHud({ kind: 'seek', text: formatTime(val) });
              }}
              onChangeEnd={(val) => {
                scrubbingRef.current = false;
                if (scrubWasPlayingRef.current) {
                  scrubWasPlayingRef.current = false;
                  void startPlayback(val);
                }
              }}
              label={formatTime}
              color="indigo"
              style={{ width: '100%', zIndex: 1 }}
              styles={{
                track: { backgroundColor: 'transparent' },
                thumb: sliderThumbStyle
              }}
            />
          </Box>

          {/* Controls */}
          <div
            className={VIDEO_COMPACT_BAR.collapseClassName}
            style={{ flexShrink: 0, ...collapseVars('340px', '0px', '16px') }}
          >
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {/* Repeat / Loop Toggle — hover + scroll: up turns it on, down turns it off */}
            <Tooltip label={isLooping ? 'Loop: On (scroll to toggle)' : 'Loop: Off (scroll to toggle)'} withinPortal>
              <ActionIcon
                variant={isLooping ? 'filled' : 'subtle'}
                color={isLooping ? 'indigo' : 'gray'}
                size="md"
                onClick={() => setIsLooping(!isLooping)}
                onWheel={onWheelAdjust((dir) => setIsLooping(dir === 1))}
                aria-label="Toggle Repeat Loop"
              >
                <IconRepeat size={16} />
              </ActionIcon>
            </Tooltip>

            {/* One menu: Speed, Pitch, Equalizer, Reverb (shared with VideoPlayer) */}
            <PlayerSettingsMenu
              speed={speed}
              onSpeed={setSpeed}
              modular={modular}
              onModular={setModular}
              extraActive={eqActive || reverbWet > 0 || pitchSt !== 0}
              opened={fxOpen}
              onOpenedChange={(open) => {
                clearAutoCloseTimer();
                if (open) setVolumeOpen(false);
                setFxOpen(open);
              }}
              watchRef={rootRef}
              buttonRef={fxButtonRef}
              closeOnClickOutside={false}
              instantClose={instantClose}
              onWheelSpeed={(dir) => changeSpeedStep(dir === 1 ? 'up' : 'down')}
              extraSections={(acc) => (
                <>
                  <Divider my={4} />
                  <EffectSection
                    title="Audio Effects"
                    open={acc.isOpen('audio')}
                    onToggle={() => acc.toggle('audio')}
                    active={eqActive || reverbWet > 0 || pitchSt !== 0}
                    onReset={() => {
                      setPitchSt(0);
                      setReverbWet(0);
                      resetEq();
                    }}
                  >
                    <Dim off={modular.pitchOn}>
                      <FxSlider
                        label="Pitch"
                        display={`${pitchSt > 0 ? '+' : ''}${pitchSt} st`}
                        value={pitchSt}
                        min={PITCH_MIN_ST}
                        max={PITCH_MAX_ST}
                        step={1}
                        color="violet"
                        onChange={setPitchSt}
                        marks={[{ value: 0 }]}
                      />
                    </Dim>
                    <Divider />
                    <ReverbControls wet={reverbWet} onWet={setReverbWet} />
                    <Divider />
                    <EqControls
                      values={{ subBass, bass, treble }}
                      onChange={(v) => {
                        setSubBass(v.subBass);
                        setBass(v.bass);
                        setTreble(v.treble);
                      }}
                    />
                  </EffectSection>                </>
              )}
            />

            {/* Volume Control Popover — hover the icon (or the open panel) and scroll */}
            <Popover
              width={280}
              position="top"
              shadow="md"
              withArrow={false}
              opened={volumeOpen}
              onChange={setVolumeOpen}
              closeOnClickOutside={false}
              transitionProps={instantClose ? { duration: 0, exitDuration: 0 } : undefined}
              classNames={{ dropdown: PLAYER_GLASS_POPOVER_CLASS }}
            >
              <Popover.Target>
                <Box onWheel={onWheelAdjust((dir) => adjustVolumeRelative(dir * 5))}>
                  <Tooltip label={`Volume: ${isMuted || volume === 0 ? 'Muted (0%)' : `${volumePct}%`} (scroll to adjust)`} withinPortal>
                    <ActionIcon
                      ref={volumeButtonRef}
                      variant="subtle"
                      color={boosted ? 'orange' : 'gray'}
                      size="md"
                      aria-label="Volume (hover and scroll to adjust, M to toggle mute)"
                      onClick={toggleVolume}
                      style={{
                        color: isMuted || volume === 0 ? '#fd6b6b' : undefined,
                        backgroundColor: isMuted || volume === 0 ? 'rgba(128, 128, 128, 0.5)' : undefined
                      }}
                    >
                      <VolumeIcon pct={volumePct} muted={isMuted || volume === 0} size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Box>
              </Popover.Target>
              <Popover.Dropdown
                style={{ padding: '8px 12px' }}
                onWheel={onWheelAdjust((dir) => adjustVolumeRelative(dir * 5))}
              >
                <MediaMenuSections />
                <Divider my={8} />
                <Dim off={modular.volumeOn}>
                <Group gap="xs" wrap="nowrap">
                  <ActionIcon variant="subtle" size="sm" onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    style={{
                      color: isMuted || volume === 0 ? '#fd6b6b' : undefined,
                      backgroundColor: isMuted || volume === 0 ? 'rgba(128, 128, 128, 0.5)' : undefined
                    }}
                  >
                    <VolumeIcon pct={volumePct} muted={isMuted || volume === 0} size={14} />
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
                  <Text size="xs" style={{ width: 38, textAlign: 'right', fontFamily: 'monospace' }}>
                    {volumePct}%
                  </Text>
                  <UnstyledButton onClick={resetVolume}>
                    <Text size="xs" c="dimmed">Reset</Text>
                  </UnstyledButton>
                </Group>
                </Dim>
              </Popover.Dropdown>
            </Popover>
            {onMini && (
              <Tooltip label={isMini ? 'Back to full window (I)' : 'Mini player (I)'} withinPortal>
                <ActionIcon
                  variant={isMini ? 'filled' : 'subtle'}
                  color={isMini ? 'indigo' : 'gray'}
                  size="md"
                  aria-label="Mini player"
                  onClick={onMini}
                >
                  {isMini ? <MiniOffIcon size={16} /> : <MiniIcon size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
            {onFullscreen && (
              <Tooltip label={isFullscreen ? 'Shrink (F / Esc)' : 'Fullscreen (F)'} withinPortal>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="md"
                  onClick={onFullscreen}
                  aria-label={isFullscreen ? 'Shrink preview' : 'Fullscreen preview'}
                >
                  {isFullscreen ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
            
          </Group>
          </div>

          {/* End slot (compact mode only) */}
          <div className={VIDEO_COMPACT_BAR.revealClassName} style={{ marginLeft: 8 }}>
            {compactEndSlot}
          </div>
        </Group>
      </Card>
      </Box>
    </>
  );

  return (
    <Box
      ref={rootRef}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      style={
        fillStage
          ? { position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }
          : { position: 'relative', width: '100%' }
      }
    >
      <PlayerGlassStyles />
      {stageNode}
      {fillStage ? (
        // Bar floats over the bottom of the stage, centered, max 640 px wide.
        <div
          ref={barWrapRef}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 3,
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <Box style={{ width: '100%', maxWidth: BAR_MAX_WIDTH }}>{barNode}</Box>
        </div>
      ) : (
        barNode
      )}

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
              id: 'audio',
              label: 'Output Device',
              content: <OutputDeviceList onPicked={() => setCtxMenu(null)} />
            },
            {
              id: 'afx',
              label: 'Audio Effects',
              width: 280,
              content: (
                <Stack gap={8}>
                  <Dim off={modular.pitchOn}>
                    <FxSlider
                      label="Pitch"
                      display={`${pitchSt > 0 ? '+' : ''}${pitchSt} st`}
                      value={pitchSt}
                      min={PITCH_MIN_ST}
                      max={PITCH_MAX_ST}
                      step={1}
                      color="violet"
                      onChange={setPitchSt}
                      marks={[{ value: 0 }]}
                    />
                  </Dim>
                  <Divider />
                  <ReverbControls wet={reverbWet} onWet={setReverbWet} />
                  <Divider />
                  <EqControls
                    values={{ subBass, bass, treble }}
                    onChange={(v) => {
                      setSubBass(v.subBass);
                      setBass(v.bass);
                      setTreble(v.treble);
                    }}
                  />
                  <UnstyledButton
                    onClick={() => {
                      setPitchSt(0);
                      setReverbWet(0);
                      resetEq();
                    }}
                  >
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

      {/* Reset Confirmation Modal */}
      <Modal
        opened={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        title="Reset Audio Effects"
        centered
        size="sm"
        classNames={{ content: PLAYER_GLASS_POPOVER_CLASS }}
        overlayProps={{ backgroundOpacity: 0.35, blur: 3 }}
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to reset all audio effects (speed, pitch, EQ, reverb, loop,
            volume) back to defaults?
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