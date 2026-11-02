import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Group,
  Modal,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  UnstyledButton
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';
import { GLASS_ACTION_CLASS } from './Glasseffect';
import { TOOLS_DIALOG, toolsDialogCss } from '@shared/transition';

export type ToolKind = 'audio' | 'silent' | 'convert' | 'compress' | 'frame';

interface Caps {
  nvidia: { h264: boolean; h265: boolean; av1: boolean };
}
interface Info {
  ok: boolean;
  error?: string;
  probe?: { durationSec: number; width: number; height: number; acodec: string | null; sizeBytes: number };
  caps?: Caps;
}
interface PlanView {
  ok: boolean;
  error?: string;
  summary: string;
  warn: string[];
  fast: boolean;
  copy: boolean;
}
interface Prog {
  jobId: string;
  pct: number;
  stage: string;
  speed: string | null;
  etaSec: number | null;
}
interface Done {
  ok: boolean;
  path?: string;
  sizeBytes?: number;
  targetBytes?: number;
  note?: string;
  error?: string;
  canceled?: boolean;
}

interface Opts {
  audioFormat: string;
  container: 'mp4' | 'webm' | 'mkv' | 'gif';
  codec: 'same' | 'h264' | 'h265' | 'av1';
  encoder: 'auto' | 'cpu' | 'nvidia';
  bestQuality: boolean;
  targetMB: number;
  lockRes: boolean;
  lockFps: boolean;
  gifWidth: number;
  gifFps: number;
}

const DEFAULTS: Opts = {
  audioFormat: 'original',
  container: 'mp4',
  codec: 'same',
  encoder: 'auto',
  bestQuality: false,
  targetMB: 20,
  lockRes: false,
  lockFps: false,
  gifWidth: 480,
  gifFps: 15
};
const KEY = 'gam:tools';
const loadOpts = (): Opts => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { ...DEFAULTS, ...(p && typeof p === 'object' ? p : {}) };
  } catch {
    return { ...DEFAULTS };
  }
};

const TOOLS: { value: ToolKind; label: string; hint: string }[] = [
  { value: 'audio', label: 'Audio', hint: 'Save the sound of this video as its own file.' },
  { value: 'silent', label: 'No audio', hint: 'Save a copy of the video without sound. Instant, no quality loss.' },
  {
    value: 'convert',
    label: 'Convert',
    hint: 'Change the format. Streams are copied when they already fit, so it can be instant and lossless.'
  },
  {
    value: 'compress',
    label: 'Compress',
    hint: 'Shrink the video to a size you pick and keep as much quality as possible.'
  },
  { value: 'frame', label: 'Frame', hint: 'Save the frame the player is on right now as a PNG.' }
];

const TITLES: Record<ToolKind, string> = {
  audio: 'Extract audio',
  silent: 'Remove audio',
  convert: 'Convert',
  compress: 'Compress to size',
  frame: 'Save frame'
};

// Limits change over time, so these are only starting points. Edit the number freely.
const SIZE_PRESETS = [
  { label: 'Discord', mb: 10 },
  { label: 'Email', mb: 20 },
  { label: 'Web trailer', mb: 50 }
];

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 2 : 1)} MB`;
const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

interface Props {
  tool: ToolKind;
  libraryId: string;
  fileId: number;
  filename: string;
  /** True while the Anime4K upscaler is on (it shares the GPU with the encoder). */
  upscalerOn: boolean;
  /** Current playback time in seconds (used by "Save frame"). */
  getTime: () => number;
  onTool?: (t: ToolKind) => void;
  onClose: () => void;
}

export function ToolsDialog({ tool, libraryId, fileId, filename, upscalerOn, getTime, onClose }: Props) {
  const g = (window as any).gam;
  const [info, setInfo] = useState<Info | null>(null);
  const [opts, setOpts] = useState<Opts>(loadOpts);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [adv, setAdv] = useState(false);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const jobRef = useRef('');
  const planSeq = useRef(0);

  const set = (partial: Partial<Opts>) => setOpts((o) => ({ ...o, ...partial }));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(opts));
    } catch {
      // ignore
    }
  }, [opts]);

  // File info + which encoders really work on this PC.
  useEffect(() => {
    let dead = false;
    setInfo(null);
    Promise.resolve(g?.toolsInfo?.(libraryId, fileId))
      .then((r: Info | undefined) => {
        if (!dead) setInfo(r ?? { ok: false, error: 'Tools are not available (the preload file was not updated).' });
      })
      .catch((e: unknown) => {
        if (!dead) setInfo({ ok: false, error: String((e as Error)?.message ?? e) });
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, fileId]);

  useEffect(() => {
    if (!g?.onToolsProgress) return undefined;
    return g.onToolsProgress((p: Prog) => {
      if (p.jobId === jobRef.current) setProg(p);
    }) as () => void;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDone(null);
  }, [tool]);

  // Compress has no GIF; the other tools keep what you picked.
  const container = tool === 'compress' && opts.container === 'gif' ? 'mp4' : opts.container;
  const sendKey = JSON.stringify({ ...opts, container, tool });

  // Live one-line plan (built by the main process, the same code that runs the job).
  useEffect(() => {
    if (!info?.ok) return undefined;
    const seq = ++planSeq.current;
    const t = window.setTimeout(() => {
      Promise.resolve(g?.toolsPlan?.(libraryId, fileId, JSON.parse(sendKey)))
        .then((r: PlanView | undefined) => {
          if (seq === planSeq.current) setPlan(r ?? null);
        })
        .catch(() => {
          if (seq === planSeq.current) {
            setPlan({ ok: false, error: 'Could not build a plan.', summary: '', warn: [], fast: false, copy: false });
          }
        });
    }, 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, sendKey, libraryId, fileId]);

  const start = async (saveAs = false) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    jobRef.current = id;
    setRunning(true);
    setDone(null);
    setProg({ jobId: id, pct: 0, stage: 'Starting', speed: null, etaSec: null });
    try {
      const r: Done = await g.toolsRun(id, libraryId, fileId, { ...JSON.parse(sendKey), atSec: getTime(), saveAs });
      setDone(r);
    } catch (e) {
      setDone({ ok: false, error: String((e as Error)?.message ?? e) });
    } finally {
      setRunning(false);
      setProg(null);
    }
  };
  const cancel = () => void g?.toolsCancel?.(jobRef.current);

  const nv = info?.caps?.nvidia;
  const hasNvidia = !!nv && (nv.h264 || nv.h265 || nv.av1);
  const hint = TOOLS.find((t) => t.value === tool)?.hint ?? '';
  const showEncoderOptions = tool === 'compress' || (tool === 'convert' && container !== 'gif');
  const containers =
    tool === 'compress'
      ? [
          { value: 'mp4', label: 'MP4' },
          { value: 'webm', label: 'WebM' },
          { value: 'mkv', label: 'MKV' }
        ]
      : [
          { value: 'mp4', label: 'MP4' },
          { value: 'webm', label: 'WebM' },
          { value: 'mkv', label: 'MKV' },
          { value: 'gif', label: 'GIF' }
        ];

  return (
    <Modal
      opened
      onClose={() => {
        if (!running) onClose();
      }}
      closeOnClickOutside={!running}
      closeOnEscape={!running}
      withCloseButton={!running}
      title={TITLES[tool]}
      centered
      size={540}
      zIndex={1100}
      classNames={{ content: PLAYER_GLASS_POPOVER_CLASS }}
      overlayProps={{ backgroundOpacity: 0.35, blur: 3 }}
      transitionProps={{ transition: 'pop', duration: TOOLS_DIALOG.durationMs, timingFunction: TOOLS_DIALOG.cssEasing }}
    >
      <Stack gap="sm">
        <style>{toolsDialogCss()}</style>
        <Text size="xs" c="dimmed" truncate>
          {filename}
        </Text>

        <Text size="xs" c="dimmed">
          {hint}
        </Text>

        {!info && <Text size="sm">Reading the file and checking this PC's encoders...</Text>}
        {info && !info.ok && (
          <Text size="sm" c="red">
            {info.error}
          </Text>
        )}

        {info?.ok && (
          <>
            {tool === 'audio' && (
              <Select
                label="Format"
                size="xs"
                allowDeselect={false}
                comboboxProps={{ zIndex: 1200 }}
                disabled={running}
                value={opts.audioFormat}
                onChange={(v) => v && set({ audioFormat: v })}
                data={[
                  { value: 'original', label: 'Original (no re-encode, no quality loss)' },
                  { value: 'mp3', label: 'MP3' },
                  { value: 'wav', label: 'WAV (uncompressed)' },
                  { value: 'flac', label: 'FLAC (lossless)' },
                  { value: 'm4a', label: 'M4A (AAC)' },
                  { value: 'opus', label: 'Opus' }
                ]}
              />
            )}

            {tool === 'convert' && (
              <Stack gap={6}>
                <Text size="xs" c="dimmed">
                  Format
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  disabled={running}
                  value={container}
                  onChange={(v) => set({ container: v as Opts['container'] })}
                  data={containers}
                />
                {container === 'gif' && (
                  <Group grow gap="xs">
                    <Select
                      label="Width"
                      size="xs"
                      allowDeselect={false}
                      comboboxProps={{ zIndex: 1200 }}
                      disabled={running}
                      value={String(opts.gifWidth)}
                      onChange={(v) => v && set({ gifWidth: Number(v) })}
                      data={[
                        { value: '320', label: '320 px' },
                        { value: '480', label: '480 px' },
                        { value: '640', label: '640 px' },
                        { value: '800', label: '800 px' },
                        { value: '0', label: 'Original' }
                      ]}
                    />
                    <Select
                      label="Frame rate"
                      size="xs"
                      allowDeselect={false}
                      comboboxProps={{ zIndex: 1200 }}
                      disabled={running}
                      value={String(opts.gifFps)}
                      onChange={(v) => v && set({ gifFps: Number(v) })}
                      data={[
                        { value: '10', label: '10 fps' },
                        { value: '15', label: '15 fps' },
                        { value: '24', label: '24 fps' }
                      ]}
                    />
                  </Group>
                )}
              </Stack>
            )}

            {tool === 'compress' && (
              <Stack gap={6}>
                <Group align="flex-end" gap="xs" wrap="nowrap">
                  <NumberInput
                    label="Target size"
                    size="xs"
                    w={130}
                    min={0.5}
                    max={100000}
                    step={1}
                    decimalScale={1}
                    suffix=" MB"
                    disabled={running}
                    value={opts.targetMB}
                    onChange={(v) => typeof v === 'number' && set({ targetMB: v })}
                  />
                  <Group gap={6} wrap="wrap">
                    {SIZE_PRESETS.map((p) => (
                      <Button
                        key={p.label}
                        size="compact-xs"
                        variant={opts.targetMB === p.mb ? 'filled' : 'default'}
                        disabled={running}
                        onClick={() => set({ targetMB: p.mb })}
                      >
                        {p.label} {p.mb}
                      </Button>
                    ))}
                  </Group>
                </Group>
                <Text size="xs" c="dimmed">
                  Format
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  disabled={running}
                  value={container}
                  onChange={(v) => set({ container: v as Opts['container'] })}
                  data={containers}
                />
              </Stack>
            )}

            {showEncoderOptions && (
              <Box>
                <UnstyledButton onClick={() => setAdv((a) => !a)}>
                  <Group gap={4}>
                    {adv ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                    <Text size="xs" c="dimmed">
                      Advanced
                    </Text>
                  </Group>
                </UnstyledButton>
                <Collapse in={adv}>
                  <Stack gap={8} mt={8}>
                    <div>
                      <Text size="xs" c="dimmed" mb={4}>
                        Encoder
                      </Text>
                      <SegmentedControl
                        size="xs"
                        fullWidth
                        disabled={running}
                        value={opts.encoder}
                        onChange={(v) => set({ encoder: v as Opts['encoder'] })}
                        data={[
                          { value: 'auto', label: 'Auto' },
                          { value: 'cpu', label: 'CPU (native)' },
                          { value: 'nvidia', label: 'NVIDIA', disabled: !hasNvidia }
                        ]}
                      />
                      <Text size="10px" c="dimmed" mt={4}>
                        {hasNvidia
                          ? 'NVIDIA encoder found. Auto uses it, which is several times faster. CPU is a little better per megabyte.'
                          : 'No working NVIDIA encoder was found, so the CPU is used.'}
                      </Text>
                    </div>
                    <div>
                      <Text size="xs" c="dimmed" mb={4}>
                        Codec
                      </Text>
                      <SegmentedControl
                        size="xs"
                        fullWidth
                        disabled={running}
                        value={opts.codec}
                        onChange={(v) => set({ codec: v as Opts['codec'] })}
                        data={[
                          { value: 'same', label: 'Same as source' },
                          { value: 'h264', label: 'H.264' },
                          { value: 'h265', label: 'H.265' },
                          { value: 'av1', label: 'AV1' }
                        ]}
                      />
                      {(opts.codec === 'h265' || opts.codec === 'av1') && (
                        <Text size="10px" c="yellow" mt={4}>
                          Smaller and better per megabyte, but some players, chats and browsers cannot open it.
                        </Text>
                      )}
                    </div>
                    <Switch
                      size="xs"
                      label="Best quality (slower, uses the CPU)"
                      disabled={running}
                      checked={opts.bestQuality}
                      onChange={(e) => set({ bestQuality: e.currentTarget.checked })}
                    />
                    {tool === 'compress' && (
                      <>
                        <Switch
                          size="xs"
                          label="Keep the resolution"
                          disabled={running}
                          checked={opts.lockRes}
                          onChange={(e) => set({ lockRes: e.currentTarget.checked })}
                        />
                        <Switch
                          size="xs"
                          label="Keep the frame rate"
                          disabled={running}
                          checked={opts.lockFps}
                          onChange={(e) => set({ lockFps: e.currentTarget.checked })}
                        />
                      </>
                    )}
                  </Stack>
                </Collapse>
              </Box>
            )}

            {upscalerOn && showEncoderOptions && opts.encoder !== 'cpu' && (
              <Text size="10px" c="yellow">
                The upscaler is on and shares the GPU with the encoder. Turn it off for faster results.
              </Text>
            )}

            {/* The plan: what will happen, before anything runs */}
            <Box
              p="xs"
              style={{ borderRadius: 8, background: 'rgba(128,128,128,0.14)', minHeight: 40 }}
            >
              {!plan && (
                <Text size="xs" c="dimmed">
                  Working out the plan...
                </Text>
              )}
              {plan && !plan.ok && (
                <Text size="xs" c="red">
                  {plan.error}
                </Text>
              )}
              {plan && plan.ok && <Text size="xs">{plan.summary}</Text>}
              {plan?.ok &&
                plan.warn.map((w, i) => (
                  <Text key={i} size="10px" c="yellow" mt={4}>
                    {w}
                  </Text>
                ))}
            </Box>

            {running && prog && (
              <Stack gap={4}>
                <Progress value={prog.pct} size="sm" animated />
                <Group justify="space-between">
                  <Text size="xs">{prog.stage}</Text>
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                    {prog.pct}%{prog.speed ? ` \u00b7 ${prog.speed}` : ''}
                    {prog.etaSec != null ? ` \u00b7 ${clock(prog.etaSec)} left` : ''}
                  </Text>
                </Group>
              </Stack>
            )}

            {done && done.ok && done.path && (
              <Stack gap={4}>
                <Text size="sm" c="green">
                  Saved {baseName(done.path)} ({mb(done.sizeBytes ?? 0)}) next to the original.
                </Text>
                {done.targetBytes != null && (
                  <Text size="xs" c={done.sizeBytes! > done.targetBytes ? 'yellow' : 'dimmed'}>
                    Target {mb(done.targetBytes)}, result {mb(done.sizeBytes ?? 0)}.
                    {done.note ? ` ${done.note} Try a slightly lower target.` : ''}
                  </Text>
                )}
              </Stack>
            )}
            {done && !done.ok && !done.canceled && (
              <Text size="xs" c="red" style={{ wordBreak: 'break-word' }}>
                {done.error}
              </Text>
            )}
            {done && done.canceled && (
              <Text size="xs" c="dimmed">
                Canceled.
              </Text>
            )}

            <Group justify="flex-end" gap="sm" mt={4}>
              {done?.ok && done.path && (
                <UnstyledButton
                  className={`${GLASS_ACTION_CLASS} gam-tools-btn`}
                  data-tone="soft"
                  data-i="0"
                  onClick={() => void g?.toolsReveal?.(done.path)}
                >
                  Reveal
                </UnstyledButton>
              )}
              {running ? (
                <UnstyledButton
                  className={`${GLASS_ACTION_CLASS} gam-tools-btn`}
                  data-tone="soft"
                  data-i="1"
                  onClick={cancel}
                >
                  Cancel
                </UnstyledButton>
              ) : (
                <>
                  <UnstyledButton
                    className={`${GLASS_ACTION_CLASS} gam-tools-btn`}
                    data-tone="soft"
                    data-i="1"
                    disabled={!plan?.ok}
                    onClick={() => void start(true)}
                  >
                    Save As
                  </UnstyledButton>
                  <UnstyledButton
                    className={`${GLASS_ACTION_CLASS} gam-tools-btn`}
                    data-i="2"
                    disabled={!plan?.ok}
                    onClick={() => void start(false)}
                  >
                    Run
                  </UnstyledButton>
                </>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}