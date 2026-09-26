import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Loader,
  Card,
  Group,
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
  IconPlayerPlay,
  IconPlayerPause,
  IconVolume,
  IconVolumeOff,
  IconWand,
  IconGauge,
  IconAdjustmentsHorizontal
} from '@tabler/icons-react';
import { AudioVisualizer, audioVizStore } from './AudioVisualizer';

interface AudioPlayerProps {
  libraryId: string;
  fileId: number;
  filename: string;
  thumbSrc?: string | null;
  /** Show the big live visualizer above the player (and hide the parent's static waveform image). */
  showHero?: boolean;
  /** Height of the big visualizer in px. */
  heroHeight?: number;
}

const EQ_MAX_DB = 12;
// How much of an EQ boost gets taken back off the overall level (0 = none, 1 = all of it).
// Kept small so boosting doesn't make the track much quieter; the limiter catches any peaks.
const EQ_HEADROOM = 0.25;

// Volume goes up to 200%. The slider sticks at 100% so it's easy to land on, and only
// lets go once the user keeps pushing past VOLUME_SNAP_HIGH.
const VOLUME_MAX_PCT = 200;
const VOLUME_SNAP_LOW = 94; // dragging down from above: lock at 100 from here
const VOLUME_SNAP_HIGH = 125; // dragging up: has to be pushed past this to go over 100

// Analyser resolution used by the visualizers
const VIZ_FFT = 4096;

// --- Persisted audio effects -----------------------------------------------
// Plain module-level store (no subscription needed — it's only read once per
// AudioPlayer mount via a lazy useState initializer, and written on every
// change). This is what lets pitch/EQ/speed/reverb survive the player being
// unmounted and remounted as the user clicks between files, folders, and
// libraries — previously each remount reset back to useState's hardcoded
// defaults. Volume/mute are intentionally left out: they already have their
// own dedicated Reset control in the volume popover.
interface PersistedAudioEffects {
  speed: number;
  pitch: number;
  reverbWet: number;
  subBass: number;
  bass: number;
  treble: number;
}

const DEFAULT_AUDIO_EFFECTS: PersistedAudioEffects = {
  speed: 1,
  pitch: 0,
  reverbWet: 0,
  subBass: 0,
  bass: 0,
  treble: 0
};

let persistedEffects: PersistedAudioEffects = { ...DEFAULT_AUDIO_EFFECTS };

const audioEffectsStore = {
  get: (): PersistedAudioEffects => persistedEffects,
  set(partial: Partial<PersistedAudioEffects>) {
    persistedEffects = { ...persistedEffects, ...partial };
  },
  reset(): PersistedAudioEffects {
    persistedEffects = { ...DEFAULT_AUDIO_EFFECTS };
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

// detune also changes the playback rate, so real rate = speed * 2^(semitones / 12)
const effectiveRate = (speed: number, pitchSemitones: number) =>
  speed * Math.pow(2, pitchSemitones / 12);

const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

export function AudioPlayer({
  libraryId,
  fileId,
  filename,
  thumbSrc,
  showHero = true,
  heroHeight = 260
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // True once the user clicks Play (or hits space) while still decoding, OR
  // once a new file starts loading — remembered so playback starts
  // automatically the instant it's ready. This is also what drives
  // autoplay-on-select: every fresh load queues a pending play.
  const [pendingPlay, setPendingPlay] = useState(false);
  const pendingPlayRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Audio Effects state — seeded from the persisted store, not hardcoded
  // defaults, so switching files/folders/libraries keeps whatever the user
  // last dialed in.
  const [speed, setSpeed] = useState(() => audioEffectsStore.get().speed);
  const [pitch, setPitch] = useState(() => audioEffectsStore.get().pitch);
  const [reverbWet, setReverbWet] = useState(() => audioEffectsStore.get().reverbWet);
  const [subBass, setSubBass] = useState(() => audioEffectsStore.get().subBass);
  const [bass, setBass] = useState(() => audioEffectsStore.get().bass);
  const [treble, setTreble] = useState(() => audioEffectsStore.get().treble);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);

  // Playback position tracking: position (buffer seconds) at the moment ctx time = anchor
  const positionRef = useRef<number>(0);
  const anchorRef = useRef<number>(0);
  const rateRef = useRef<number>(1);
  const isPlayingRef = useRef<boolean>(false);
  const animFrameRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Always holds the latest values so audio code never reads stale state
  const paramsRef = useRef({ volume, isMuted, speed, pitch, reverbWet, subBass, bass, treble });
  paramsRef.current = { volume, isMuted, speed, pitch, reverbWet, subBass, bass, treble };

  const getPosition = () => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return positionRef.current;
    return positionRef.current + (ctx.currentTime - anchorRef.current) * rateRef.current;
  };

  const stopSource = () => {
    const s = sourceNodeRef.current;
    if (!s) return;
    s.onended = null;
    try { s.stop(); } catch {}
    try { s.disconnect(); } catch {}
    sourceNodeRef.current = null;
  };

  const cancelFrame = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  // Pushes volume / reverb / EQ values into the audio graph
  const applyParams = () => {
    const ctx = audioCtxRef.current;
    const g = graphRef.current;
    if (!ctx || !g) return;
    const p = paramsRef.current;
    const t = ctx.currentTime;

    g.master.gain.setTargetAtTime(p.isMuted ? 0 : p.volume, t, 0.01);
    g.dry.gain.setTargetAtTime(1 - p.reverbWet, t, 0.01);
    g.wet.gain.setTargetAtTime(p.reverbWet, t, 0.01);

    g.sub.gain.setTargetAtTime(p.subBass, t, 0.02);
    g.bass.gain.setTargetAtTime(p.bass, t, 0.02);
    g.treble.gain.setTargetAtTime(p.treble, t, 0.02);

    // Take back only a little level when boosting, the limiter handles the rest
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
    convolver.buffer = createImpulseResponse(ctx); // created once, reused for every play/seek

    preamp.connect(sub);
    sub.connect(bassFilter);
    bassFilter.connect(trebleFilter);
    trebleFilter.connect(master);
    trebleFilter.connect(analyser); // visualizer taps after EQ, before volume

    // Soft limiter at the very end so boosted bass can't clip or distort
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

    // Reset synchronously, before the async fetch/decode starts, so
    // switching files fast doesn't show a stale duration/position/play
    // state left over from the previous file during the decode window.
    // Note: effect params (speed/pitch/EQ/reverb) are deliberately NOT
    // reset here — they carry over from the persisted store.
    cancelFrame();
    stopSource();
    isPlayingRef.current = false;
    positionRef.current = 0;
    audioBufferRef.current = null;
    graphRef.current = null;
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsLoading(true);
    // Autoplay: every file selection (first click, or switching between
    // files) queues a pending play, so playback starts the moment decode
    // finishes rather than requiring a manual Play click.
    pendingPlayRef.current = true;
    setPendingPlay(true);
    audioVizStore.set({ analyser: null, isPlaying: false });

    const loadAudio = async () => {
      try {
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtxClass();
        audioCtxRef.current = ctx;

        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (!active) return;

        audioBufferRef.current = decodedBuffer;
        const graph = buildGraph(ctx);
        graphRef.current = graph;
        audioVizStore.set({ analyser: graph.analyser, isPlaying: false });
        applyParams();

        setDuration(decodedBuffer.duration);
        positionRef.current = 0;
        isPlayingRef.current = false;
        setCurrentTime(0);
        setIsPlaying(false);
        setIsLoading(false);
        if (pendingPlayRef.current) {
          pendingPlayRef.current = false;
          setPendingPlay(false);
          startPlayback(0);
        }
      } catch (err) {
        console.error('Failed to load or decode audio file:', err);
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
      stopSource();
      isPlayingRef.current = false;
      graphRef.current = null;
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, fileId]);

  const tick = () => {
    if (!isPlayingRef.current) return;
    const total = audioBufferRef.current?.duration ?? 0;
    const pos = getPosition();

    if (pos >= total) {
      stopSource();
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

  const startPlayback = (offset: number) => {
    const ctx = audioCtxRef.current;
    const buffer = audioBufferRef.current;
    const graph = graphRef.current;
    if (!ctx || !buffer || !graph) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    stopSource();
    cancelFrame();

    const { speed: s, pitch: p } = paramsRef.current;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.detune.value = p * 100;
    source.playbackRate.value = s;
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
    const pos = getPosition(); // must be read before isPlayingRef flips
    stopSource();
    cancelFrame();
    isPlayingRef.current = false;
    positionRef.current = pos;
    setCurrentTime(pos);
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (!audioBufferRef.current || !graphRef.current) {
      // Still decoding — toggle the queued intent; play fires automatically
      // the moment loadAudio() finishes above.
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
      startPlayback(positionRef.current);
    }
  };

  const handleSeek = (val: number) => {
    positionRef.current = val;
    setCurrentTime(val);
    if (isPlayingRef.current) {
      startPlayback(val);
    }
  };

  // Volume, mute, reverb and EQ -> audio graph (and persist the effect values)
  useEffect(() => {
    applyParams();
    audioEffectsStore.set({ reverbWet, subBass, bass, treble });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, isMuted, reverbWet, subBass, bass, treble]);

  // Speed and pitch: re-anchor the position first so the time counter doesn't jump
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (ctx && isPlayingRef.current) {
      positionRef.current = getPosition(); // uses the old rate
      anchorRef.current = ctx.currentTime;
    }
    rateRef.current = effectiveRate(speed, pitch);

    const src = sourceNodeRef.current;
    if (src && ctx && isPlayingRef.current) {
      src.playbackRate.setValueAtTime(speed, ctx.currentTime);
      src.detune.setValueAtTime(pitch * 100, ctx.currentTime);
    }

    audioEffectsStore.set({ speed, pitch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, pitch]);

  const formatTime = (timeSec: number) => {
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Keep the latest togglePlay in a ref so the key listener is only registered once
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if the user is typing inside an input or editable field
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault(); // Stop default browser scrolling
        e.stopPropagation(); // Stop the event from reaching the app's global Quick Look handler
        togglePlayRef.current();
      }
    };

    // Capture phase so this fires before app-level global key handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // 'R' key or middle-click on the player prompts to reset pitch/EQ/reverb/speed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setConfirmResetOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      // Middle click
      e.preventDefault();
      setConfirmResetOpen(true);
    }
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault(); // Prevent default middle-click scroll icon
  };

  const confirmResetEffects = () => {
    const defaults = audioEffectsStore.reset();
    setSpeed(defaults.speed);
    setPitch(defaults.pitch);
    setReverbWet(defaults.reverbWet);
    setSubBass(defaults.subBass);
    setBass(defaults.bass);
    setTreble(defaults.treble);
    setConfirmResetOpen(false);
  };

  // Tell every <AudioVisualizer /> on screen whether audio is playing
  useEffect(() => {
    audioVizStore.set({ isPlaying });
  }, [isPlaying]);

  // No longer needed: PreviewPane's AudioPreview no longer renders a
  // competing static waveform image above the player (removed — the live
  // hero visualizer below covers that role), so there's nothing left to
  // find-and-hide via DOM position guessing.

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

  return (
    <Box
      ref={rootRef}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      style={{ position: 'relative', width: '100%' }}
    >
      {/* Big live visualizer, sits right above the player where the static waveform image was */}
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

          {/* File Name & Time Counter — shrinks first so the seekbar keeps its usable width */}
          <Box style={{ flexShrink: 1, flexGrow: 0, minWidth: 0, maxWidth: 180, overflow: 'hidden' }}>
            <Text size="xs" fw={700} truncate c="gray.2">
              {filename}
            </Text>
            <Text size="10px" c="dimmed" style={{ fontFamily: 'monospace' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </Box>

          {/* Center: Waveform + Interactive Seekbar Overlay — guaranteed a usable minimum width */}
          <Box
            style={{
              flex: '1 1 140px',
              minWidth: 140,
              position: 'relative',
              height: 40,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {thumbSrc && (
              <img
                src={thumbSrc}
                alt="Waveform background"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: 0.35,
                  pointerEvents: 'none',
                  filter: 'brightness(1.2)'
                }}
              />
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
                track: { backgroundColor: 'rgba(255,255,255,0.1)' },
                thumb: { border: '2px solid #fff' }
              }}
            />
          </Box>

          {/* Right Controls: Speed, EQ, Pitch/Reverb, Volume — never shrinks, stays clickable */}
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {/* Speed Selection Menu */}
            <Menu shadow="md" width={100} position="top">
              <Menu.Target>
                <Tooltip label="Speed" withinPortal>
                  <ActionIcon
                    variant={speed !== 1 ? 'filled' : 'subtle'}
                    color={speed !== 1 ? 'indigo' : 'gray'}
                    size="md"
                  >
                    <IconGauge size={16} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <Menu.Item key={s} onClick={() => setSpeed(s)}>
                    {s}x
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>

            {/* EQ Popover: Sub Bass, Bass, Treble */}
            <Popover width={240} position="top" shadow="md" withArrow>
              <Popover.Target>
                <Tooltip label="Equalizer" withinPortal>
                  <ActionIcon
                    variant={eqActive ? 'filled' : 'subtle'}
                    color={eqActive ? 'teal' : 'gray'}
                    size="md"
                    aria-label="Equalizer"
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
                      />
                    </div>
                  ))}
                </Stack>
              </Popover.Dropdown>
            </Popover>

            {/* Effects Popover: Reverb & Pitch */}
            <Popover width={220} position="top" shadow="md" withArrow>
              <Popover.Target>
                <Tooltip label="Audio Effects" withinPortal>
                  <ActionIcon
                    variant={pitch !== 0 || reverbWet > 0 ? 'filled' : 'subtle'}
                    color={pitch !== 0 || reverbWet > 0 ? 'violet' : 'gray'}
                    size="md"
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
                      onChange={setPitch}
                      color="violet"
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
                      onChange={setReverbWet}
                      label={(val) => `${Math.round(val * 100)}%`}
                      color="violet"
                    />
                  </div>
                </Stack>
              </Popover.Dropdown>
            </Popover>

            {/* Volume Control: 0-200%, sticks at 100%, turns orange when boosted above it */}
            <Popover width={280} position="top" shadow="md" withArrow>
              <Popover.Target>
                <ActionIcon
                  variant={boosted ? 'light' : 'subtle'}
                  color={boosted ? 'orange' : 'gray'}
                  size="md"
                  aria-label="Volume"
                >
                  {isMuted || volume === 0 ? (
                    <IconVolumeOff size={16} />
                  ) : (
                    <IconVolume size={16} />
                  )}
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown style={{ padding: '8px 12px' }}>
                <Group gap="xs" wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    color={isMuted ? 'red' : 'gray'}
                    size="sm"
                    onClick={() => setIsMuted(!isMuted)}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
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
                    value={volumePct}
                    onChange={handleVolumeChange}
                    label={(v) => `${v}%`}
                    marks={[{ value: 100 }]}
                    style={{ flex: 1 }}
                    color={volumePct > 100 ? 'orange' : 'indigo'}
                  />
                  <Text
                    size="xs"
                    w={38}
                    ta="right"
                    c={boosted ? 'orange' : 'dimmed'}
                    style={{ fontFamily: 'monospace' }}
                  >
                    {volumePct}%
                  </Text>
                  <Button
                    size="compact-xs"
                    variant={boosted ? 'light' : 'subtle'}
                    color={boosted ? 'orange' : 'gray'}
                    onClick={resetVolume}
                    disabled={!isMuted && volume === 1}
                  >
                    Reset
                  </Button>
                </Group>
              </Popover.Dropdown>
            </Popover>
          </Group>
        </Group>
      </Card>

      {/* Middle-click or 'R' -> confirm before wiping pitch/EQ/reverb/speed */}
      <Modal
        opened={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        title="Reset audio effects?"
        centered
        size="xs"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This resets pitch, EQ, reverb, and playback speed back to default. Volume is left as-is.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => setConfirmResetOpen(false)}>
              No
            </Button>
            <Button color="red" size="xs" onClick={confirmResetEffects}>
              Yes, reset
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}