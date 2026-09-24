import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Group,
  Menu,
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
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Audio Effects state
  const [pitch, setPitch] = useState(0);
  const [reverbWet, setReverbWet] = useState(0);

  // EQ state (dB)
  const [subBass, setSubBass] = useState(0);
  const [bass, setBass] = useState(0);
  const [treble, setTreble] = useState(0);

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
      } catch (err) {
        console.error('Failed to load or decode audio file:', err);
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

  // Volume, mute, reverb and EQ -> audio graph
  useEffect(() => {
    applyParams();
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

  // Tell every <AudioVisualizer /> on screen whether audio is playing
  useEffect(() => {
    audioVizStore.set({ isPlaying });
  }, [isPlaying]);

  // Hide the big static waveform image the parent draws above the player while the live
  // visualizer is shown. Restored when the player unmounts.
  useEffect(() => {
    if (!showHero) return;
    const hidden = new Map<HTMLElement, string>();
    let frame: number | null = null;

    const hideParentThumb = () => {
      frame = null;
      const root = rootRef.current;
      if (!root) return;
      const player = root.getBoundingClientRect();
      document.querySelectorAll<HTMLElement>('img, canvas').forEach((el) => {
        if (hidden.has(el) || root.contains(el)) return;
        // Only a big image sitting above the player (and lined up with it) is the preview
        // waveform. Grid thumbnails are below the player and icons are too small.
        const r = el.getBoundingClientRect();
        const isAbove = r.bottom <= player.top + 4;
        const overlapsX = r.right > player.left && r.left < player.right;
        if (r.height >= 80 && isAbove && overlapsX) {
          hidden.set(el, el.style.visibility);
          el.style.visibility = 'hidden';
        }
      });
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(hideParentThumb);
    };

    schedule();
    const observer = new MutationObserver((mutations) => {
      const root = rootRef.current;
      if (root && mutations.some((m) => !root.contains(m.target))) schedule();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
    window.addEventListener('resize', schedule);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      hidden.forEach((prev, el) => {
        el.style.visibility = prev;
      });
    };
  }, [showHero, fileId]);

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
    <Box ref={rootRef} style={{ position: 'relative', width: '100%' }}>
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
          >
            {isPlaying ? <IconPlayerPause size={20} /> : <IconPlayerPlay size={20} style={{ marginLeft: 2 }} />}
          </ActionIcon>

          {/* File Name & Time Counter */}
          <Box style={{ minWidth: 120, maxWidth: 180 }}>
            <Text size="xs" fw={700} truncate c="gray.2">
              {filename}
            </Text>
            <Text size="10px" c="dimmed" style={{ fontFamily: 'monospace' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </Box>

          {/* Center: Waveform + Interactive Seekbar Overlay */}
          <Box style={{ flex: 1, position: 'relative', height: 40, display: 'flex', alignItems: 'center' }}>
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

          {/* Right Controls: Speed, EQ, Pitch/Reverb, Volume */}
          <Group gap="xs" wrap="nowrap">
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
    </Box>
  );
}