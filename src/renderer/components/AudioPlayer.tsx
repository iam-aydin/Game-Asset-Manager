import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Menu,
  Modal,
  Popover,
  Slider,
  Stack,
  Text,
  Tooltip,
  UnstyledButton
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconGauge,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat,
  IconVolume,
  IconVolumeOff,
  IconWand
} from '@tabler/icons-react';
import { AudioVisualizer, audioVizStore } from './AudioVisualizer';

interface AudioPlayerProps {
  libraryId: string;
  fileId: number;
  filename: string;
  coverUrl?: string; // Optional cover image URL or custom protocol path
  autoPlay?: boolean;
  showHero?: boolean;
  heroHeight?: number;
}

const EQ_MAX_DB = 12;
const EQ_HEADROOM = 0.25;

const VOLUME_MAX_PCT = 200;
const VOLUME_SNAP_LOW = 94;
const VOLUME_SNAP_HIGH = 125;

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

const getSpeedColor = (s: number): string | undefined => {
  if (s < 1) return '#2e7d32'; // Dark Green
  if (s === 1) return undefined; // Non-colored / Default
  if (s <= 1.75) return '#857e22'; // Custom Yellow
  if (s === 2) return '#c15000'; // Custom Dark Orange
  if (s === 3) return '#8b0000'; // Dark Red
  if (s === 4) return '#e03131'; // Red
  return undefined;
};

const VIZ_FFT = 4096;
const WAVEFORM_BARS = 72;

const sliderThumbStyle = {
  backgroundColor: 'var(--wh3d-slider-thumb-bg, #4c6ef5)',
  border: '2px solid var(--wh3d-slider-thumb-border, #000000)'
};

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
  pitch: number;
  reverbWet: number;
  subBass: number;
  bass: number;
  treble: number;
  isLooping: boolean;
}

const DEFAULT_AUDIO_EFFECTS: PersistedAudioEffects = {
  speed: 1,
  pitch: 0,
  reverbWet: 0,
  subBass: 0,
  bass: 0,
  treble: 0,
  isLooping: true
};

const STORAGE_KEY = 'wh3d_audio_player_effects';

const loadPersistedEffects = (): PersistedAudioEffects => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_AUDIO_EFFECTS, ...JSON.parse(saved) };
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
  analyser: AnalyserNode;
}

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

const effectiveRate = (speed: number, pitchSemitones: number) =>
  speed * Math.pow(2, pitchSemitones / 12);

const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

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

export function AudioPlayer({
  libraryId,
  fileId,
  filename,
  coverUrl,
  autoPlay = false,
  showHero = true,
  heroHeight = 260
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPlay, setPendingPlay] = useState(autoPlay);
  const pendingPlayRef = useRef(autoPlay);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  // The cover slot only exists once the image has actually loaded, so files
  // without embedded artwork render exactly as if the feature weren't there.
  const [coverReady, setCoverReady] = useState(false);
  const resolvedCoverUrl = coverUrl || `wh3d-cover://${libraryId}/${fileId}`;

  const [speed, setSpeed] = useState(() => audioEffectsStore.get().speed);
  const [pitch, setPitch] = useState(() => audioEffectsStore.get().pitch);
  const [reverbWet, setReverbWet] = useState(() => audioEffectsStore.get().reverbWet);
  const [subBass, setSubBass] = useState(() => audioEffectsStore.get().subBass);
  const [bass, setBass] = useState(() => audioEffectsStore.get().bass);
  const [treble, setTreble] = useState(() => audioEffectsStore.get().treble);
  const [isLooping, setIsLooping] = useState(() => audioEffectsStore.get().isLooping);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Panel Popover States
  const [eqOpen, setEqOpen] = useState(false);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);

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
  const eqButtonRef = useRef<HTMLButtonElement | null>(null);
  const effectsButtonRef = useRef<HTMLButtonElement | null>(null);
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
    if (eqOpen || effectsOpen || volumeOpen) {
      autoCloseTimerRef.current = setTimeout(() => {
        setEqOpen(false);
        setEffectsOpen(false);
        setVolumeOpen(false);
      }, 7000);
    }
  };

  useEffect(() => {
    if (!eqOpen && !effectsOpen && !volumeOpen) return;

    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const popovers = document.querySelectorAll('.mantine-Popover-dropdown');
      for (const popover of Array.from(popovers)) {
        if (popover.contains(target)) return;
      }

      if (
        eqButtonRef.current?.contains(target) ||
        effectsButtonRef.current?.contains(target) ||
        volumeButtonRef.current?.contains(target)
      ) {
        return;
      }

      if (seekbarRef.current?.contains(target)) {
        return;
      }

      clearAutoCloseTimer();
      setEqOpen(false);
      setEffectsOpen(false);
      setVolumeOpen(false);
    };

    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
  }, [eqOpen, effectsOpen, volumeOpen]);

  const toggleEq = () => {
    clearAutoCloseTimer();
    setEffectsOpen(false);
    setVolumeOpen(false);
    setEqOpen((prev) => !prev);
  };

  const toggleEffects = () => {
    clearAutoCloseTimer();
    setEqOpen(false);
    setVolumeOpen(false);
    setEffectsOpen((prev) => !prev);
  };

  const toggleVolume = () => {
    clearAutoCloseTimer();
    setEqOpen(false);
    setEffectsOpen(false);
    setVolumeOpen((prev) => !prev);
  };

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  useEffect(() => {
    return () => clearAutoCloseTimer();
  }, []);

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

  const paramsRef = useRef({ volume, isMuted, speed, pitch, reverbWet, subBass, bass, treble, isLooping });
  paramsRef.current = { volume, isMuted, speed, pitch, reverbWet, subBass, bass, treble, isLooping };

  const getPosition = () => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return positionRef.current;
    const elapsed = (ctx.currentTime - anchorRef.current) * rateRef.current;
    const rawPos = positionRef.current + elapsed;
    const total = audioBufferRef.current?.duration ?? 0;

    if (total > 0 && paramsRef.current.isLooping) {
      return rawPos % total;
    }
    return rawPos;
  };

  const stopSource = (fadeSec = 0) => {
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
    g.master.gain.setTargetAtTime(p.isMuted ? 0 : p.volume, t, 0.01);
    g.dry.gain.setTargetAtTime(1 - p.reverbWet, t, 0.01);
    g.wet.gain.setTargetAtTime(p.reverbWet, t, 0.01);

    g.sub.gain.setTargetAtTime(p.subBass, t, 0.02);
    g.bass.gain.setTargetAtTime(p.bass, t, 0.02);
    g.treble.gain.setTargetAtTime(p.treble, t, 0.02);

    const maxBoost = Math.max(0, p.subBass, p.bass, p.treble);
    g.preamp.gain.setTargetAtTime(Math.pow(10, -(maxBoost * EQ_HEADROOM) / 20), t, 0.02);
  };

  const buildGraph = (ctx: AudioContext): AudioGraph => {
    const preamp = ctx.createGain();

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
    convolver.buffer = createImpulseResponse(ctx);

    preamp.connect(sub);
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

    return { preamp, sub, bass: bassFilter, treble: trebleFilter, master, dry, wet, analyser };
  };

  useEffect(() => {
    let active = true;
    const fileUrl = `wh3d-file://${libraryId}/${fileId}`;

    cancelFrame();
    stopSource(0);
    isPlayingRef.current = false;
    positionRef.current = 0;
    audioBufferRef.current = null;
    graphRef.current = null;
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsLoading(true);
    setWaveformPeaks([]);

    pendingPlayRef.current = autoPlay;
    setPendingPlay(autoPlay);

    audioVizStore.set({ analyser: null, isPlaying: false });

    const loadAudio = async () => {
      try {
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();

        const ctx = getSharedAudioContext();
        audioCtxRef.current = ctx;

        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (!active) return;

        audioBufferRef.current = decodedBuffer;
        const graph = buildGraph(ctx);
        graphRef.current = graph;
        audioVizStore.set({ analyser: graph.analyser, isPlaying: false });
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
          await startPlayback(0);
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
      audioVizStore.set({ analyser: null, isPlaying: false });
      cancelFrame();
      stopSource(0.25);
      isPlayingRef.current = false;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, fileId, autoPlay]);

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

  const startPlayback = async (offset: number) => {
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
      return;
    }

    if (isPlayingRef.current) {
      pausePlayback();
    } else {
      const total = audioBufferRef.current?.duration ?? 0;
      if (positionRef.current >= total) {
        positionRef.current = 0;
      }
      void startPlayback(positionRef.current);
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
  };

  const adjustVolumeRelative = (deltaPct: number) => {
    setIsMuted(false);
    setVolume((prevVol) => {
      const currentPct = Math.round(prevVol * 100);
      const newPct = Math.max(0, Math.min(VOLUME_MAX_PCT, currentPct + deltaPct));
      return newPct / 100;
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

    if (direction === 'down') {
      const nextIdx = Math.max(0, closestIdx - 1);
      setSpeed(SPEED_PRESETS[nextIdx]);
    } else if (direction === 'up') {
      const nextIdx = Math.min(SPEED_PRESETS.length - 1, closestIdx + 1);
      setSpeed(SPEED_PRESETS[nextIdx]);
    }
  };

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) {
      adjustVolumeRelative(5);
    } else if (e.deltaY > 0) {
      adjustVolumeRelative(-5);
    }
  };

  useEffect(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.loop = isLooping;
    }
    audioEffectsStore.set({ isLooping });
  }, [isLooping]);

  useEffect(() => {
    applyParams();
    audioEffectsStore.set({ reverbWet, subBass, bass, treble });
  }, [volume, isMuted, reverbWet, subBass, bass, treble]);

  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (ctx && isPlayingRef.current) {
      positionRef.current = getPosition();
      anchorRef.current = ctx.currentTime;
    }
    rateRef.current = effectiveRate(speed, pitch);

    const src = sourceNodeRef.current;
    if (src && ctx && isPlayingRef.current) {
      src.playbackRate.setValueAtTime(speed, ctx.currentTime);
      src.detune.setValueAtTime(pitch * 100, ctx.currentTime);
    }

    audioEffectsStore.set({ speed, pitch });
  }, [speed, pitch]);

  const formatTime = (timeSec: number) => {
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        target &&
        (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();

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
    setPitch(defaults.pitch);
    setReverbWet(defaults.reverbWet);
    setSubBass(defaults.subBass);
    setBass(defaults.bass);
    setTreble(defaults.treble);
    setIsLooping(defaults.isLooping);
    setConfirmResetOpen(false);
  };

  useEffect(() => {
    audioVizStore.set({ isPlaying });
  }, [isPlaying]);

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

  const eqBands = [
    { label: 'Sub Bass', hint: '~60 Hz', value: subBass, set: setSubBass },
    { label: 'Bass', hint: '~150 Hz', value: bass, set: setBass },
    { label: 'Treble', hint: '~6 kHz', value: treble, set: setTreble }
  ];
  const eqActive = subBass !== 0 || bass !== 0 || treble !== 0;

  const resetEq = () => {
    setSubBass(0);
    setBass(0);
    setTreble(0);
  };

  const speedColor = getSpeedColor(speed);

  return (
    <Box
      ref={rootRef}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      onWheel={handleVolumeWheel}
      style={{ position: 'relative', width: '100%' }}
    >
      {showHero && (
        <Box
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(100% + 10px)',
            height: heroHeight,
            zIndex: 2,
            pointerEvents: 'none'
          }}
        >
          <AudioVisualizer bars={44} height="100%" />
        </Box>
      )}
      <Card
        withBorder
        radius="lg"
        p="xs"
        bg="var(--mantine-color-dark-8)"
        style={{
          border: '1px solid var(--mantine-color-dark-4)',
          width: '100%',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}
      >
        <Group wrap="nowrap" gap="md" align="center">
          {/* Cover art — only rendered when the file actually has embedded artwork */}
          {coverReady && (
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
          )}

          {/* Play Button */}
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

          {/* File Name & Time Counter */}
          <Box style={{ flexShrink: 1, flexGrow: 0, minWidth: 0, maxWidth: 180, overflow: 'hidden' }}>
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
              <Box style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <WaveformBars peaks={waveformPeaks} progress={duration ? currentTime / duration : 0} />
              </Box>
            )}
            <Slider
              size="sm"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
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
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {/* Repeat / Loop Toggle */}
            <Tooltip label={isLooping ? 'Loop: On' : 'Loop: Off'} withinPortal>
              <ActionIcon
                variant={isLooping ? 'filled' : 'subtle'}
                color={isLooping ? 'indigo' : 'gray'}
                size="md"
                onClick={() => setIsLooping(!isLooping)}
                aria-label="Toggle Repeat Loop"
              >
                <IconRepeat size={16} />
              </ActionIcon>
            </Tooltip>

            {/* Speed Selection */}
            <Menu shadow="md" width={100} position="top">
              <Menu.Target>
                <Tooltip label={`Speed: ${speed}x (J/K/L)`} withinPortal>
                  <ActionIcon
                    variant={speed !== 1 ? 'filled' : 'subtle'}
                    color={speedColor ?? 'gray'}
                    size="md"
                  >
                    <IconGauge size={16} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                {SPEED_PRESETS.map((s) => {
                  const isSelected = speed === s;
                  const itemColor = getSpeedColor(s);
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
                      <Text size="xs" fw={isSelected ? 700 : 500} c={itemColor}>
                        {s}x
                      </Text>
                    </Menu.Item>
                  );
                })}
              </Menu.Dropdown>
            </Menu>

            {/* EQ Popover */}
            <Popover
              width={240}
              position="top"
              shadow="md"
              withArrow
              opened={eqOpen}
              onChange={setEqOpen}
              closeOnClickOutside={false}
            >
              <Popover.Target>
                <Tooltip label="Equalizer" withinPortal>
                  <ActionIcon
                    ref={eqButtonRef}
                    variant={eqActive ? 'filled' : 'subtle'}
                    color={eqActive ? 'teal' : 'gray'}
                    size="md"
                    aria-label="Equalizer"
                    onClick={toggleEq}
                  >
                    <IconAdjustmentsHorizontal size={16} />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="xs" fw={600}>
                      Equalizer
                    </Text>
                    <UnstyledButton onClick={resetEq} disabled={!eqActive}>
                      <Text size="xs" c={eqActive ? 'teal' : 'dimmed'}>
                        Reset
                      </Text>
                    </UnstyledButton>
                  </Group>
                  {eqBands.map((band) => (
                    <div key={band.label}>
                      <Group justify="space-between" mb={2}>
                        <Text size="xs" c="dimmed">
                          {band.label} ({band.hint})
                        </Text>
                        <Text size="xs" c={band.value !== 0 ? 'teal' : 'dimmed'} style={{ fontFamily: 'monospace' }}>
                          {formatDb(band.value)}
                        </Text>
                      </Group>
                      <Slider
                        size="xs"
                        min={-EQ_MAX_DB}
                        max={EQ_MAX_DB}
                        step={1}
                        value={band.value}
                        onChange={band.set}
                        label={formatDb}
                        marks={[{ value: 0 }]}
                        color="teal"
                        styles={{ thumb: sliderThumbStyle }}
                      />
                    </div>
                  ))}
                </Stack>
              </Popover.Dropdown>
            </Popover>

            {/* Audio Effects Popover (Pitch & Reverb) */}
            <Popover
              width={220}
              position="top"
              shadow="md"
              withArrow
              opened={effectsOpen}
              onChange={setEffectsOpen}
              closeOnClickOutside={false}
            >
              <Popover.Target>
                <Tooltip label="Audio Effects" withinPortal>
                  <ActionIcon
                    ref={effectsButtonRef}
                    variant={pitch !== 0 || reverbWet > 0 ? 'filled' : 'subtle'}
                    color={pitch !== 0 || reverbWet > 0 ? 'violet' : 'gray'}
                    size="md"
                    onClick={toggleEffects}
                  >
                    <IconWand size={16} />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  <Text size="xs" fw={600}>
                    Audio Effects
                  </Text>
                  <div>
                    <Text size="xs" c="dimmed">
                      Pitch ({pitch > 0 ? `+${pitch}` : pitch} st)
                    </Text>
                    <Slider
                      size="xs"
                      min={-12}
                      max={12}
                      step={1}
                      value={pitch}
                      onChange={(val) => setPitch(val)}
                      color="violet"
                      styles={{ thumb: sliderThumbStyle }}
                    />
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Reverb ({Math.round(reverbWet * 100)}%)
                    </Text>
                    <Slider
                      size="xs"
                      min={0}
                      max={1}
                      step={0.05}
                      value={reverbWet}
                      onChange={(val) => setReverbWet(val)}
                      label={(val) => `${Math.round(val * 100)}%`}
                      color="violet"
                      styles={{ thumb: sliderThumbStyle }}
                    />
                  </div>
                </Stack>
              </Popover.Dropdown>
            </Popover>

            {/* Volume Control Popover */}
            <Popover
              width={280}
              position="top"
              shadow="md"
              withArrow
              opened={volumeOpen}
              onChange={setVolumeOpen}
              closeOnClickOutside={false}
            >
              <Popover.Target>
                <Box>
                  <Tooltip label={`Volume: ${isMuted || volume === 0 ? 'Muted (0%)' : `${volumePct}%`}`} withinPortal>
                    <ActionIcon
                      ref={volumeButtonRef}
                      variant="subtle"
                      color={boosted ? 'orange' : 'gray'}
                      size="md"
                      aria-label="Volume (Scroll anywhere to adjust, M to toggle mute)"
                      onClick={toggleVolume}
                      style={{
                        color: isMuted || volume === 0 ? '#fd6b6b' : undefined,
                        backgroundColor: isMuted || volume === 0 ? 'rgba(128, 128, 128, 0.5)' : undefined
                      }}
                    >
                      {isMuted || volume === 0 ? (
                        <IconVolumeOff size={16} />
                      ) : (
                        <IconVolume size={16} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                </Box>
              </Popover.Target>
              <Popover.Dropdown style={{ padding: '8px 12px' }}>
                <Group gap="xs" wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    style={{
                      color: isMuted || volume === 0 ? '#fd6b6b' : undefined,
                      backgroundColor: isMuted || volume === 0 ? 'rgba(128, 128, 128, 0.5)' : undefined
                    }}
                  >
                    {isMuted || volume === 0 ? (
                      <IconVolumeOff size={14} />
                    ) : (
                      <IconVolume size={14} />
                    )}
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
              </Popover.Dropdown>
            </Popover>
          </Group>
        </Group>
      </Card>

      {/* Reset Confirmation Modal */}
      <Modal
        opened={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        title="Reset Audio Effects"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to reset all audio effects (speed, pitch, EQ, reverb, loop) back to defaults?
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