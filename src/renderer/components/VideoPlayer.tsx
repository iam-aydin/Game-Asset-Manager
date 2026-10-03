import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Popover,
  Slider,
  Text,
  Tooltip,
  UnstyledButton
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconGauge,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat,
  IconVolume,
  IconVolumeOff
} from '@tabler/icons-react';

interface VideoPlayerProps {
  libraryId: string;
  fileId: number;
  filename: string;
  /** File extension, used only to give a clearer error for unsupported containers. */
  ext?: string;
  autoPlay?: boolean;
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

const sliderThumbStyle = {
  backgroundColor: 'var(--wh3d-slider-thumb-bg, #4c6ef5)',
  border: '2px solid var(--wh3d-slider-thumb-border, #000000)'
};

// ---- Persisted prefs (same pattern as the audio player's effects store) ----
// Mute is intentionally NOT persisted: nobody wants a video to silently open muted.

interface PersistedVideoPrefs {
  speed: number;
  volume: number; // 0..1 (HTMLMediaElement can't exceed 1 without Web Audio)
  isLooping: boolean;
}

const DEFAULT_VIDEO_PREFS: PersistedVideoPrefs = {
  speed: 1,
  volume: 1,
  isLooping: false
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

const formatTime = (timeSec: number) => {
  if (!Number.isFinite(timeSec) || timeSec < 0) return '0:00';
  const hrs = Math.floor(timeSec / 3600);
  const mins = Math.floor((timeSec % 3600) / 60);
  const secs = Math.floor(timeSec % 60);
  const ss = secs < 10 ? `0${secs}` : `${secs}`;
  if (hrs > 0) return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${ss}`;
  return `${mins}:${ss}`;
};

export function VideoPlayer({ libraryId, fileId, filename, ext, autoPlay = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);

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
    // defaultPlaybackRate survives the load algorithm; playbackRate alone is reset by it.
    v.defaultPlaybackRate = speed;
    v.playbackRate = speed;
    videoPrefsStore.set({ speed });
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.loop = isLooping;
    videoPrefsStore.set({ isLooping });
  }, [isLooping]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ---- Actions ----
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || error) return;
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
            e.currentTarget.playbackRate = speed;
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
            cursor: error ? 'default' : 'pointer'
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
      </Box>

      {/* Control bar */}
      <Box p="xs" style={{ flexShrink: 0 }}>
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

              {/* Volume — hover the icon (or the open panel) and scroll */}
              <Popover
                width={260}
                position="top"
                shadow="md"
                withArrow
                opened={volumeOpen}
                onChange={setVolumeOpen}
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
    </Box>
  );
}