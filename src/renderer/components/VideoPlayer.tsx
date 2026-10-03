import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Card,
  Center,
  Collapse,
  Divider,
  Group,
  Loader,
  Menu,
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

const sliderThumbStyle = {
  backgroundColor: 'var(--wh3d-slider-thumb-bg, #4c6ef5)',
  border: '2px solid var(--wh3d-slider-thumb-border, #000000)'
};

// ---- Effects model --------------------------------------------------------

interface VideoFx {
  brightness: number; // %, 100 = unchanged
  contrast: number; // %
  saturation: number; // %
  hue: number; // degrees
  flip: boolean; // mirror horizontally
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
  flip: false
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

type PersistedVideoPrefs = {
  speed: number;
  volume: number; // 0..1 (HTMLMediaElement can't exceed 1 without Web Audio)
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
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  sub: BiquadFilterNode;
  bass: BiquadFilterNode;
  treble: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  limiter: DynamicsCompressorNode;
}

/** Same chain as AudioPlayer: preamp -> sub shelf -> bass peak -> treble shelf
 *  -> dry/reverb mix -> limiter. Volume stays on the <video> element. */
const buildVideoAudioGraph = (video: HTMLVideoElement): VideoAudioGraph => {
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
  dry.connect(limiter);
  treble.connect(convolver);
  convolver.connect(wet);
  wet.connect(limiter);

  return { ctx, source, preamp, sub, bass, treble, dry, wet, limiter };
};

const applyAudioFx = (g: VideoAudioGraph, fx: AudioFx) => {
  const t = g.ctx.currentTime;
  g.dry.gain.setTargetAtTime(1 - fx.reverbWet, t, 0.01);
  g.wet.gain.setTargetAtTime(fx.reverbWet, t, 0.01);
  g.sub.gain.setTargetAtTime(fx.subBass, t, 0.02);
  g.bass.gain.setTargetAtTime(fx.bass, t, 0.02);
  g.treble.gain.setTargetAtTime(fx.treble, t, 0.02);
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
  const scrubbingRef = useRef(false);
  const graphRef = useRef<VideoAudioGraph | null>(null);

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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Effects popover
  const [fxOpen, setFxOpen] = useState(false);
  const [videoSectionOpen, setVideoSectionOpen] = useState(false);
  const [audioSectionOpen, setAudioSectionOpen] = useState(false);
  const [vfx, setVfx] = useState<VideoFx>(() => {
    const p = videoPrefsStore.get();
    return {
      brightness: p.brightness,
      contrast: p.contrast,
      saturation: p.saturation,
      hue: p.hue,
      flip: p.flip
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

  const vfxActive =
    vfx.brightness !== 100 ||
    vfx.contrast !== 100 ||
    vfx.saturation !== 100 ||
    vfx.hue !== 0 ||
    vfx.flip;
  const afxActive =
    afx.pitch !== 0 ||
    afx.reverbWet !== 0 ||
    afx.subBass !== 0 ||
    afx.bass !== 0 ||
    afx.treble !== 0;
  const fxActive = vfxActive || afxActive;

  const hasCssFilter =
    vfx.brightness !== 100 || vfx.contrast !== 100 || vfx.saturation !== 100 || vfx.hue !== 0;
  const videoFilter = hasCssFilter
    ? `brightness(${vfx.brightness}%) contrast(${vfx.contrast}%) saturate(${vfx.saturation}%) hue-rotate(${vfx.hue}deg)`
    : undefined;

  const src = `wh3d-file://${libraryId}/${fileId}`;

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

  // Audio effects: the Web Audio graph is only built the first time an effect
  // is actually turned on, so plain playback never goes through it.
  useEffect(() => {
    videoPrefsStore.set(afx);
    if (!afxActive && !graphRef.current) return;
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
    applyAudioFx(graphRef.current, afx);
    if (graphRef.current.ctx.state === 'suspended') {
      void graphRef.current.ctx.resume().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afx]);

  useEffect(() => {
    return () => {
      const g = graphRef.current;
      if (!g) return;
      try {
        g.source.disconnect();
      } catch {}
      try {
        g.limiter.disconnect();
      } catch {}
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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
      const pct = Math.max(0, Math.min(100, Math.round(prev * 100) + deltaPct));
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

      const a = actionsRef.current;
      const key = e.key.toLowerCase();

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
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

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

  const setV = (partial: Partial<VideoFx>) => setVfx((prev) => ({ ...prev, ...partial }));
  const setA = (partial: Partial<AudioFx>) => setAfx((prev) => ({ ...prev, ...partial }));

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
            <Menu shadow="md" width={100} position="top">
              <Menu.Target>
                <Tooltip label={`Speed: ${speed}x (J/K/L, or scroll)`} withinPortal>
                  <ActionIcon
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
              </Menu.Dropdown>
            </Menu>

            {/* Effects — two collapsible categories, like the Filter menu */}
            <Popover
              width={280}
              position="top"
              shadow="md"
              withArrow={false}
              opened={fxOpen}
              onChange={setFxOpen}
              classNames={{ dropdown: PLAYER_GLASS_POPOVER_CLASS }}
            >
              <Popover.Target>
                <Tooltip label="Effects" withinPortal>
                  <ActionIcon
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
                  <Switch
                    size="xs"
                    label="Mirror (flip horizontally)"
                    checked={vfx.flip}
                    onChange={(e) => setV({ flip: e.currentTarget.checked })}
                  />
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
              </Popover.Dropdown>
            </Popover>

            {/* Volume — hover the icon (or the open panel) and scroll */}
            <Popover
              width={260}
              position="top"
              shadow="md"
              withArrow={false}
              opened={volumeOpen}
              onChange={setVolumeOpen}
              classNames={{ dropdown: PLAYER_GLASS_POPOVER_CLASS }}
            >
              <Popover.Target>
                <Box onWheel={onWheelAdjust((dir) => adjustVolumeRelative(dir * 5))}>
                  <Tooltip
                    label={`Volume: ${muted ? 'Muted (0%)' : `${volumePct}%`} (scroll to adjust, M to mute)`}
                    withinPortal
                  >
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="md"
                      aria-label="Volume"
                      onClick={() => setVolumeOpen((o) => !o)}
                      style={{
                        color: muted ? '#fd6b6b' : undefined,
                        backgroundColor: muted ? 'rgba(128, 128, 128, 0.5)' : undefined
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
                <Group gap="xs" wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    style={{
                      color: muted ? '#fd6b6b' : undefined,
                      backgroundColor: muted ? 'rgba(128, 128, 128, 0.5)' : undefined
                    }}
                  >
                    {muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
                  </ActionIcon>
                  <Slider
                    size="xs"
                    min={0}
                    max={100}
                    step={1}
                    value={isMuted ? 0 : Math.round(volume * 100)}
                    onChange={(pct) => {
                      setIsMuted(false);
                      setVolume(pct / 100);
                    }}
                    label={(val) => `${val}%`}
                    color="indigo"
                    style={{ flex: 1 }}
                    styles={{ thumb: sliderThumbStyle }}
                  />
                  <Text size="xs" style={{ width: 38, textAlign: 'right', fontFamily: 'monospace' }}>
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
              </Popover.Dropdown>
            </Popover>

            <Tooltip label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} withinPortal>
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minHeight: 0,
        background: 'var(--wh3d-viewport-bg)'
      }}
    >
      <PlayerGlassStyles />

      {/* Video surface */}
      <Box style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000' }}>
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            // Re-apply persisted settings after the element finishes loading.
            e.currentTarget.volume = Math.max(0, Math.min(1, volume));
            e.currentTarget.muted = isMuted;
            e.currentTarget.preservesPitch = afx.pitch === 0;
            e.currentTarget.playbackRate = effectiveRate(speed, afx.pitch);
            e.currentTarget.loop = isLooping;
          }}
          onLoadedData={(e) => {
            setIsBuffering(false);
            if (autoPlay) void e.currentTarget.play().catch(() => undefined);
          }}
          onCanPlay={() => setIsBuffering(false)}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onPlay={() => setIsPlaying(true)}
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
            objectFit: 'contain',
            display: 'block',
            background: '#000',
            cursor: error ? 'default' : 'pointer',
            filter: videoFilter,
            transform: vfx.flip ? 'scaleX(-1)' : undefined
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
    </Box>
  );
}