import type { ReactNode } from 'react';
import { NativeSelect, Text } from '@mantine/core';
import { OptionList } from './PlayerContextMenu';
import { useAudioOutput } from './audioOutput';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {subs && onSubIndex && (
        <Field label="Subtitles">
          <NativeSelect
            size="xs"
            disabled={subs.length === 0}
            value={String(subIndex)}
            onChange={(e) => onSubIndex(Number(e.currentTarget.value))}
            data={[
              { value: '-1', label: subs.length ? 'Off' : 'No subtitle files found' },
              ...subs.map((l, i) => ({ value: String(i), label: l }))
            ]}
          />
        </Field>
      )}
      {audioTracks && audioTracks.length > 1 && onAudioTrack && (
        <Field label="Audio track">
          <NativeSelect
            size="xs"
            value={String(enabledTrack)}
            onChange={(e) => onAudioTrack(Number(e.currentTarget.value))}
            data={audioTracks.map((t, i) => ({ value: String(i), label: t.label }))}
          />
        </Field>
      )}
      <Field label="Output device">
        <NativeSelect
          size="xs"
          value={outValue}
          onChange={(e) => out.setDeviceId(e.currentTarget.value)}
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