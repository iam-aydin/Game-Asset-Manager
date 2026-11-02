import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Collapse, Text, UnstyledButton } from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import { OptionList } from './PlayerContextMenu';
import { useAudioOutput } from './audioOutput';

const GSEL_CSS = `
.gam-gsel-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(128, 128, 128, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  transition: background 140ms ease, border-color 140ms ease;
}
.gam-gsel-btn:hover:not(:disabled) { background: rgba(128, 128, 128, 0.24); }
.gam-gsel-btn:disabled { opacity: 0.5; cursor: default; }
.gam-gsel-list {
  margin-top: 4px;
  padding: 4px;
  border-radius: 8px;
  max-height: 168px;
  overflow-y: auto;
  scrollbar-width: thin;
  background: rgba(128, 128, 128, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.gam-gsel-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12px;
  transition: background 120ms ease;
}
.gam-gsel-row:hover { background: rgba(255, 255, 255, 0.1); }
.gam-gsel-row[data-selected='true'] {
  background: color-mix(in srgb, var(--mantine-color-indigo-4) 24%, transparent);
}
/* gam-gsel-fix: never wider than the menu, long names get an ellipsis */
.gam-gsel-btn,
.gam-gsel-list,
.gam-gsel-row {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}
.gam-gsel-btn,
.gam-gsel-row { overflow: hidden; }
.gam-gsel-list { overflow-x: hidden; }

`;

// gam-marquee-waapi: text that does not fit slides sideways (pause, slide, pause, slide back).
// Uses the Web Animations API, so the Windows "animation effects" setting cannot switch it off.
const MARQUEE_PAUSE_MS = 1000;
const MARQUEE_MS_PER_PX = 14;

function Marquee({ text }: { text?: string }) {
  const outer = useRef<HTMLSpanElement | null>(null);
  const inner = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return undefined;
    let anim: Animation | null = null;
    const run = () => {
      if (anim) anim.cancel();
      anim = null;
      const shift = Math.ceil(i.scrollWidth - o.clientWidth);
      if (o.clientWidth === 0 || shift <= 1) return;
      const move = Math.min(3500, Math.max(500, shift * MARQUEE_MS_PER_PX));
      const total = 2 * MARQUEE_PAUSE_MS + 2 * move;
      const a = MARQUEE_PAUSE_MS / total;
      const b = (MARQUEE_PAUSE_MS + move) / total;
      const c = (2 * MARQUEE_PAUSE_MS + move) / total;
      const away = 'translateX(-' + shift + 'px)';
      anim = i.animate(
        [
          { transform: 'translateX(0px)', offset: 0 },
          { transform: 'translateX(0px)', offset: a, easing: 'ease-in-out' },
          { transform: away, offset: b },
          { transform: away, offset: c, easing: 'ease-in-out' },
          { transform: 'translateX(0px)', offset: 1 }
        ],
        { duration: total, iterations: Infinity, easing: 'linear' }
      );
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(o);
    ro.observe(i);
    return () => {
      ro.disconnect();
      if (anim) anim.cancel();
    };
  }, [text]);
  return (
    <span
      ref={outer}
      style={{ flex: 1, minWidth: 0, display: 'block', overflow: 'hidden', whiteSpace: 'nowrap' }}
    >
      <span ref={inner} style={{ display: 'inline-block' }}>
        {text ?? ''}
      </span>
    </span>
  );
}

function GlassSelect({
  value,
  onChange,
  data,
  disabled = false
}: {
  value: string;
  onChange: (v: string) => void;
  data: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = data.find((d) => d.value === value) ?? data[0];
  return (
    <div>
      <UnstyledButton
        className="gam-gsel-btn"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Marquee text={current?.label} />
        <IconChevronDown
          size={14}
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease'
          }}
        />
      </UnstyledButton>
      <Collapse in={open && !disabled} transitionDuration={160}>
        <div className="gam-gsel-list" onWheel={(e) => e.stopPropagation()}>
          {data.map((d) => {
            const selected = d.value === value;
            return (
              <UnstyledButton
                key={d.value}
                className="gam-gsel-row"
                data-selected={selected ? 'true' : 'false'}
                onClick={() => {
                  onChange(d.value);
                  setOpen(false);
                }}
              >
                <span style={{ width: 14, flexShrink: 0, display: 'flex' }}>
                  {selected && <IconCheck size={13} />}
                </span>
                <Marquee text={d.label} />
              </UnstyledButton>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="10px" c="dimmed" tt="uppercase" fw={700} mb={3}>
        {label}
      </Text>
      {children}
    </div>
  );
}

/** Top of the volume menu: subtitles, audio track (video only), output device. */
export function MediaMenuSections({
  subs,
  subIndex = -1,
  onSubIndex,
  audioTracks,
  onAudioTrack
}: {
  subs?: string[];
  subIndex?: number;
  onSubIndex?: (i: number) => void;
  audioTracks?: { label: string; enabled: boolean }[];
  onAudioTrack?: (i: number) => void;
}) {
  const out = useAudioOutput();
  const devices = out.devices.length ? out.devices : [{ id: 'default', label: 'System default' }];
  const outValue = devices.some((d) => d.id === out.deviceId) ? out.deviceId : devices[0].id;
  const enabledTrack = audioTracks ? Math.max(0, audioTracks.findIndex((t) => t.enabled)) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, maxWidth: '100%' }}>
      <style>{GSEL_CSS}</style>
      {subs && onSubIndex && (
        <Field label="Subtitles">
          <GlassSelect
            disabled={subs.length === 0}
            value={String(subIndex)}
            onChange={(v) => onSubIndex(Number(v))}
            data={[
              { value: '-1', label: subs.length ? 'Off' : 'No subtitle files found' },
              ...subs.map((l, i) => ({ value: String(i), label: l }))
            ]}
          />
        </Field>
      )}
      {audioTracks && audioTracks.length > 1 && onAudioTrack && (
        <Field label="Audio track">
          <GlassSelect
            value={String(enabledTrack)}
            onChange={(v) => onAudioTrack(Number(v))}
            data={audioTracks.map((t, i) => ({ value: String(i), label: t.label }))}
          />
        </Field>
      )}
      <Field label="Output device">
        <GlassSelect
          value={outValue}
          onChange={(v) => out.setDeviceId(v)}
          data={devices.map((d) => ({ value: d.id, label: d.label }))}
        />
      </Field>
    </div>
  );
}

/** Output device as a radio list (right-click menu). */
export function OutputDeviceList({ onPicked }: { onPicked?: () => void }) {
  const out = useAudioOutput();
  const devices = out.devices.length ? out.devices : [{ id: 'default', label: 'System default' }];
  const current = devices.some((d) => d.id === out.deviceId) ? out.deviceId : devices[0].id;
  return (
    <OptionList
      items={devices.map((d) => ({ label: d.label, checked: d.id === current }))}
      onPick={(i) => {
        out.setDeviceId(devices[i].id);
        onPicked?.();
      }}
    />
  );
}