import { useEffect, useState } from 'react';
import { Divider, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { PlayerGlassStyles, PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';
import { PlayerContextMenu, OptionList, type CtxSection } from './PlayerContextMenu';
import { Dim, EqControls, FxSlider, GlassSegmented, ReverbControls } from './PlayerMenu';
import { PITCH_MAX_ST, PITCH_MIN_ST } from './playerShared';
import { outputStore, useAudioOutput } from './audioOutput';
import { FontList, SUB_FONT_DEFAULT } from './SubtitleFonts';

type Vfx = {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  flip: boolean;
  flipV: boolean;
  rotate: number;
};
type Afx = { pitch: number; reverbWet: number; subBass: number; bass: number; treble: number };

/** What the player hands to the menu window when the menu opens (must be plain data). */
export interface CtxSnapshot {
  kind: 'video' | 'audio';
  subs: string[];
  subIndex: number;
  tracks: { label: string; enabled: boolean }[];
  vfx?: Vfx;
  afx: Afx;
  scaleMode?: string;
  pitchOn: boolean;
  chromeHidden?: boolean;
  speed?: number;
  modular?: { pitchOn: boolean; speedOn: boolean; volumeOn: boolean };
  subCfg?: {
    delay: number;
    size: number;
    lift: number;
    outline: number;
    shadow: number;
    boxOn: boolean;
    boxAlpha: number;
    /** 'auto' or a CSS font-family stack (see SubtitleFonts.tsx). */
    font?: string;
  };
  subPresets?: string[];
  defaults: { vfx?: Vfx; afx: Afx };
}

const CSS = `
html.gam-ctxwin, body.gam-ctxwin, body.gam-ctxwin #root { background: transparent !important; }
body.gam-ctxwin .${PLAYER_GLASS_POPOVER_CLASS} {
  background: color-mix(in srgb, var(--mantine-color-body) 95%, transparent) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: 1px solid var(--mantine-color-default-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 8px 24px rgba(0, 0, 0, 0.45);
}
`;

/** The right-click menu of the mini player, drawn in its own transparent window (see context-menu.ts). */
export function ContextMenuWindow() {
  const g = (window as any).gam;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [s, setS] = useState<CtxSnapshot | null>(null);
  const out = useAudioOutput();

  const send = (a: unknown) => g?.ctxMenuAction?.(a);
  const close = () => g?.closeContextMenu?.();

  useEffect(() => {
    document.documentElement.classList.add('gam-ctxwin');
    document.body.classList.add('gam-ctxwin');
    void Promise.resolve(g?.getContextMenuInit?.()).then((i: any) => {
      if (!i) {
        close();
        return;
      }
      setS(i.state as CtxSnapshot);
      setPos({ x: i.x, y: i.y });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the window only after the first paint, so there is no empty flash.
  useEffect(() => {
    if (!pos) return;
    requestAnimationFrame(() => requestAnimationFrame(() => g?.ctxMenuReady?.()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  if (!s || !pos) return <style>{CSS}</style>;

  const patch = (fn: (p: CtxSnapshot) => CtxSnapshot) => setS((p) => (p ? fn(p) : p));
  const setVfx = (partial: Partial<Vfx>) => {
    patch((p) => ({ ...p, vfx: { ...(p.vfx as Vfx), ...partial } }));
    send({ op: 'vfx', partial });
  };
  const setAfx = (partial: Partial<Afx>) => {
    patch((p) => ({ ...p, afx: { ...p.afx, ...partial } }));
    send({ op: 'afx', partial });
  };

  const devices = out.devices.length ? out.devices : [{ id: 'default', label: 'System default' }];
  const curDevice = devices.some((d) => d.id === out.deviceId) ? out.deviceId : devices[0].id;

  const outputList = (
    <OptionList
      items={devices.map((d) => ({ label: d.label, checked: d.id === curDevice }))}
      onPick={(i) => {
        outputStore.set(devices[i].id);
        send({ op: 'output', id: devices[i].id });
        close();
      }}
    />
  );

  const resetLink = (onClick: () => void) => (
    <UnstyledButton onClick={onClick}>
      <Text size="xs" c="dimmed">
        Reset
      </Text>
    </UnstyledButton>
  );

  // Order of the menu (top to bottom):
  //   Interface
  //   Playback
  //   Subtitles
  //   Subtitle Settings > Subtitle Sync | Subtitle Style > Presets | Fonts | Appearance
  //   Video Settings    > Video Effects | Scale & Position
  //   Audio
  //   Audio Effects
  const sections: CtxSection[] = [];

  // ---- Interface -----------------------------------------------------------
  sections.push({
    id: 'ui',
    label: 'Interface',
    width: 220,
    content: (
      <Switch
        size="xs"
        label="Hide interface (O)"
        checked={!!s.chromeHidden}
        onChange={() => {
          patch((p) => ({ ...p, chromeHidden: !p.chromeHidden }));
          send({ op: 'chrome' });
        }}
      />
    )
  });

  // ---- Playback ------------------------------------------------------------
  if (s.kind === 'video' && s.modular && s.speed !== undefined) {
    const m = s.modular;
    const setMod = (partial: Partial<typeof m>) => {
      patch((p) => ({ ...p, modular: { ...(p.modular as typeof m), ...partial } }));
      send({ op: 'modular', partial });
    };
    sections.push({
      id: 'playback',
      label: 'Playback',
      width: 250,
      content: (
        <Stack gap={8}>
          <Dim off={m.speedOn}>
            <FxSlider
              label="Speed"
              display={`${s.speed}x`}
              value={s.speed}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(x) => {
                const v = Math.round(x * 100) / 100;
                patch((p) => ({ ...p, speed: v }));
                send({ op: 'speed', value: v });
              }}
              marks={[{ value: 1 }]}
            />
          </Dim>
          <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
            Modular (random each play / loop)
          </Text>
          <Switch size="xs" label="Modular pitch" checked={m.pitchOn} onChange={(e) => setMod({ pitchOn: e.currentTarget.checked })} />
          <Switch size="xs" label="Modular speed" checked={m.speedOn} onChange={(e) => setMod({ speedOn: e.currentTarget.checked })} />
          <Switch size="xs" label="Modular volume" checked={m.volumeOn} onChange={(e) => setMod({ volumeOn: e.currentTarget.checked })} />
        </Stack>
      )
    });
  }

  // ---- Subtitles (which file) ----------------------------------------------
  if (s.kind === 'video') {
    sections.push({
      id: 'subs',
      label: 'Subtitles',
      content:
        s.subs.length === 0 ? (
          <Text size="xs" c="dimmed">
            No subtitle files found next to this video.
          </Text>
        ) : (
          <OptionList
            items={[
              { label: 'Off', checked: s.subIndex < 0 },
              ...s.subs.map((l, i) => ({ label: l, checked: s.subIndex === i }))
            ]}
            onPick={(i) => {
              patch((p) => ({ ...p, subIndex: i - 1 }));
              send({ op: 'sub', index: i - 1 });
              close();
            }}
          />
        )
    });
  }

  // ---- Subtitle Settings > Sync | Style > Presets | Fonts | Appearance ------------
  if (s.kind === 'video' && s.subCfg) {
    const c = s.subCfg;
    const setSub = (partial: Partial<typeof c>) => {
      patch((p) => ({ ...p, subCfg: { ...(p.subCfg as typeof c), ...partial } }));
      send({ op: 'subcfg', partial });
    };
    sections.push({
      id: 'subset',
      label: 'Subtitle Settings',
      children: [
        {
          id: 'subsync',
          label: 'Subtitle Sync',
          width: 250,
          content: (
            <Stack gap={8}>
              <FxSlider
                label="Delay"
                display={`${c.delay > 0 ? '+' : ''}${c.delay.toFixed(1)} s`}
                value={c.delay}
                min={-10}
                max={10}
                step={0.1}
                onChange={(x) => setSub({ delay: x })}
                marks={[{ value: 0 }]}
              />
              {resetLink(() => setSub({ delay: 0 }))}
            </Stack>
          )
        },
        {
          id: 'substyle',
          label: 'Subtitle Style',
          children: [
            {
              id: 'subpresets',
              label: 'Presets',
              content: (
                <OptionList
                  items={(s.subPresets ?? []).map((l) => ({ label: l, checked: false }))}
                  onPick={(i) => send({ op: 'subPreset', index: i })}
                />
              )
            },
            {
              id: 'subfonts',
              label: 'Fonts',
              width: 280,
              content: <FontList value={c.font ?? SUB_FONT_DEFAULT} onChange={(f) => setSub({ font: f })} />
            },
            {
              id: 'subappearance',
              label: 'Appearance',
              width: 250,
              content: (
                <Stack gap={8}>
                  <FxSlider label="Size" display={`${Math.round(c.size * 100)}%`} value={c.size} min={0.5} max={2.5} step={0.05} onChange={(x) => setSub({ size: x })} marks={[{ value: 1 }]} />
                  <FxSlider label="Height" display={`${c.lift} px`} value={c.lift} min={0} max={300} step={2} onChange={(x) => setSub({ lift: x })} marks={[{ value: 0 }]} />
                  <FxSlider label="Outline" display={`${c.outline.toFixed(1)} px`} value={c.outline} min={0} max={4} step={0.5} onChange={(x) => setSub({ outline: x })} marks={[{ value: 0 }]} />
                  <FxSlider label="Drop shadow blur" display={`${c.shadow} px`} value={c.shadow} min={0} max={16} step={1} onChange={(x) => setSub({ shadow: x })} marks={[{ value: 0 }]} />
                  <Switch size="xs" label="Background box" checked={c.boxOn} onChange={(e) => setSub({ boxOn: e.currentTarget.checked })} />
                  {c.boxOn && (
                    <FxSlider label="Box opacity" display={`${Math.round(c.boxAlpha * 100)}%`} value={c.boxAlpha} min={0.1} max={1} step={0.05} onChange={(x) => setSub({ boxAlpha: x })} marks={[{ value: 0.55 }]} />
                  )}
                  {resetLink(() => send({ op: 'subReset' }))}
                </Stack>
              )
            }
          ]
        }
      ]
    });
  }

  // ---- Video Settings > Video Effects | Scale & Position -------------------------
  if (s.kind === 'video' && s.vfx) {
    const v = s.vfx;
    sections.push({
      id: 'vidset',
      label: 'Video Settings',
      children: [
        {
          id: 'video',
          label: 'Video Effects',
          width: 250,
          content: (
            <Stack gap={8}>
              <FxSlider
                label="Brightness"
                display={`${v.brightness}%`}
                value={v.brightness}
                min={50}
                max={150}
                step={1}
                onChange={(x) => setVfx({ brightness: x })}
                marks={[{ value: 100 }]}
              />
              <FxSlider
                label="Contrast"
                display={`${v.contrast}%`}
                value={v.contrast}
                min={50}
                max={150}
                step={1}
                onChange={(x) => setVfx({ contrast: x })}
                marks={[{ value: 100 }]}
              />
              <FxSlider
                label="Saturation"
                display={`${v.saturation}%`}
                value={v.saturation}
                min={0}
                max={200}
                step={1}
                onChange={(x) => setVfx({ saturation: x })}
                marks={[{ value: 100 }]}
              />
              <FxSlider
                label="Hue"
                display={`${v.hue > 0 ? '+' : ''}${v.hue}\u00b0`}
                value={v.hue}
                min={-180}
                max={180}
                step={1}
                onChange={(x) => setVfx({ hue: x })}
                marks={[{ value: 0 }]}
              />
              <Switch
                size="xs"
                label="Mirror horizontally"
                checked={v.flip}
                onChange={(e) => setVfx({ flip: e.currentTarget.checked })}
              />
              <Switch
                size="xs"
                label="Mirror vertically"
                checked={v.flipV}
                onChange={(e) => setVfx({ flipV: e.currentTarget.checked })}
              />
              {resetLink(() => {
                patch((p) => ({ ...p, vfx: { ...(p.defaults.vfx as Vfx), rotate: (p.vfx as Vfx).rotate } }));
                send({ op: 'vfxReset' });
              })}
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
                value={s.scaleMode ?? 'fit'}
                onChange={(m) => {
                  patch((p) => ({ ...p, scaleMode: m }));
                  send({ op: 'scaleMode', mode: m });
                }}
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
                  value={String(v.rotate)}
                  onChange={(r) => setVfx({ rotate: Number(r) })}
                  data={[
                    { value: '0', label: '0\u00b0' },
                    { value: '90', label: '90\u00b0' },
                    { value: '180', label: '180\u00b0' },
                    { value: '270', label: '270\u00b0' }
                  ]}
                />
              </div>
              {resetLink(() => {
                patch((p) => ({ ...p, scaleMode: 'fit', vfx: { ...(p.vfx as Vfx), rotate: 0 } }));
                send({ op: 'scaleReset' });
              })}
            </Stack>
          )
        }
      ]
    });
  }

  // ---- Audio (track + output device) -----------------------------------------
  sections.push({
    id: 'audio',
    label: s.kind === 'video' ? 'Audio' : 'Output Device',
    content:
      s.kind === 'video' ? (
        <Stack gap={8}>
          {s.tracks.length > 1 && (
            <>
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                Audio track
              </Text>
              <OptionList
                items={s.tracks.map((t) => ({ label: t.label, checked: t.enabled }))}
                onPick={(i) => {
                  patch((p) => ({ ...p, tracks: p.tracks.map((t, k) => ({ ...t, enabled: k === i })) }));
                  send({ op: 'track', index: i });
                  close();
                }}
              />
            </>
          )}
          <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
            Output device
          </Text>
          {outputList}
        </Stack>
      ) : (
        outputList
      )
  });

  // ---- Audio Effects -----------------------------------------------------------
  sections.push({
    id: 'afx',
    label: 'Audio Effects',
    width: 250,
    content: (
      <Stack gap={8}>
        <Dim off={s.pitchOn}>
          <FxSlider
            label="Pitch"
            display={`${s.afx.pitch > 0 ? '+' : ''}${s.afx.pitch} st`}
            value={s.afx.pitch}
            min={PITCH_MIN_ST}
            max={PITCH_MAX_ST}
            step={1}
            color="violet"
            onChange={(x) => setAfx({ pitch: x })}
            marks={[{ value: 0 }]}
          />
        </Dim>
        <Divider />
        <ReverbControls wet={s.afx.reverbWet} onWet={(x) => setAfx({ reverbWet: x })} />
        <Divider />
        <EqControls
          values={{ subBass: s.afx.subBass, bass: s.afx.bass, treble: s.afx.treble }}
          onChange={(x) => setAfx(x)}
        />
        {resetLink(() => {
          patch((p) => ({ ...p, afx: { ...p.defaults.afx } }));
          send({ op: 'afxReset' });
        })}
      </Stack>
    )
  });

  return (
    <>
      <style>{CSS}</style>
      <PlayerGlassStyles />
      <PlayerContextMenu x={pos.x} y={pos.y} sections={sections} onClose={close} />
    </>
  );
}