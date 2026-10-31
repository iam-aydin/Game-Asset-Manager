import { useCallback, useSyncExternalStore } from 'react';
import { ActionIcon, Group, Popover, Slider, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAdjustmentsHorizontal } from '@tabler/icons-react';
import type { HdriId } from '@shared/hdri';
import { GLASS_ACTION_CLASS, GLASS_POPOVER_CLASS, TOOLTIP_PROPS } from '../components/Glasseffect';

// ---------------------------------------------------------------------------
// Values + storage (everything about the HDRI adjustments lives in this file)
// ---------------------------------------------------------------------------

export interface HdriAdjust {
  blur: number;        // not in the menu yet; always 0
  brightness: number;  // multiplies backgroundIntensity
  light: number;       // multiplies environmentIntensity (how much the HDRI lights the model)
  rotation: number;    // degrees, spins the HDRI
}

export const DEFAULT_HDRI_ADJUST: HdriAdjust = { blur: 0, brightness: 1, light: 1, rotation: 0 };

// Remembered per HDRI in localStorage and shared by every viewer
// (preview pane, mini player, fullscreen, compare), so they always agree.
const STORAGE_KEY = 'gam.hdriAdjust.v1';
type Store = Partial<Record<HdriId, HdriAdjust>>;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function load(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<HdriAdjust> | null>;
    const out: Store = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (!v || typeof v !== 'object') continue;
      out[id as HdriId] = {
        blur: 0, // blur is off for now, whatever was stored before
        brightness: num(v.brightness, DEFAULT_HDRI_ADJUST.brightness),
        light: num(v.light, DEFAULT_HDRI_ADJUST.light),
        rotation: num(v.rotation, DEFAULT_HDRI_ADJUST.rotation)
      };
    }
    return out;
  } catch {
    return {};
  }
}

let store: Store = load();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Store {
  return store;
}

export function useHdriAdjust(hdri: HdriId): [HdriAdjust, (next: HdriAdjust) => void] {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const adjust = snap[hdri] ?? DEFAULT_HDRI_ADJUST;
  const setAdjust = useCallback(
    (next: HdriAdjust) => {
      store = { ...store, [hdri]: next };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      } catch {
        /* storage unavailable: the setting still applies for this session */
      }
      for (const l of listeners) l();
    },
    [hdri]
  );
  return [adjust, setAdjust];
}

// ---------------------------------------------------------------------------
// The glass menu
// ---------------------------------------------------------------------------

/** Small icon button that opens the sliders for the given HDRI. Disabled for "none". */
export function HdriAdjustButton({ hdri }: { hdri: HdriId }) {
  const [value, setValue] = useHdriAdjust(hdri);
  const disabled = hdri === 'none';

  const row = (
    label: string,
    key: keyof HdriAdjust,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string
  ) => (
    <div>
      <Group justify="space-between">
        <Text size="xs">{label}</Text>
        <Text size="xs" c="dimmed">{fmt(value[key])}</Text>
      </Group>
      <Slider
        size="sm"
        min={min}
        max={max}
        step={step}
        value={value[key]}
        label={null}
        onChange={(v) => setValue({ ...value, [key]: v })}
      />
    </div>
  );

  return (
    <Popover
      position="top"
      withArrow={false}
      withinPortal
      width={260}
      disabled={disabled}
      classNames={{ dropdown: GLASS_POPOVER_CLASS }}
    >
      <Popover.Target>
        <Tooltip
          {...TOOLTIP_PROPS}
          label={disabled ? 'Pick an environment to adjust it' : 'Adjust environment'}
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            disabled={disabled}
            aria-label="Adjust environment"
          >
            <IconAdjustmentsHorizontal size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          {row('Backdrop brightness', 'brightness', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`)}
          {row('HDRI light on model', 'light', 0, 3, 0.05, (v) => `${Math.round(v * 100)}%`)}
          {row('Rotation', 'rotation', 0, 360, 1, (v) => `${v}\u00B0`)}
          <UnstyledButton
            className={GLASS_ACTION_CLASS}
            data-tone="soft"
            onClick={() => setValue(DEFAULT_HDRI_ADJUST)}
          >
            Reset
          </UnstyledButton>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}