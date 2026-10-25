import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Divider,
  Group,
  Popover,
  RangeSlider,
  ScrollArea,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconChartBar,
  IconChevronRight,
  IconDeviceFloppy,
  IconTrash,
  IconWaveSine,
  IconX
} from '@tabler/icons-react';
import { PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';
import {
  DEFAULT_MODULAR,
  EQ_FLAT,
  EQ_MAX_DB,
  EQ_PRESETS,
  MODULAR_MAX,
  MODULAR_MIN,
  MODULAR_STEP,
  REVERB_PREDELAY_MAX,
  REVERB_PRESETS,
  REVERB_TIME_MAX,
  REVERB_TIME_MIN,
  SPEED_PRESETS,
  formatDb,
  fxActions,
  sameEq,
  snapModular,
  getSpeedColor,
  sliderThumbStyle,
  useFxPresets,
  useMenuMaxHeight,
  type EqValues,
  type ModularSettings,
  type ReverbParams
} from './playerShared';

/**
 * Shared player menu pieces. AudioPlayer and VideoPlayer both use these, so a
 * change to the look or behaviour of a menu here shows up in both.
 */

// ---- Glass scroll area ------------------------------------------------------
// Thin translucent track + glowing indigo/violet glass thumb.
const glassScrollStyles = {
  scrollbar: {
    background: 'rgba(128, 128, 128, 0.14)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    zIndex: 5
  },
  thumb: {
    background: 'linear-gradient(180deg, rgba(120, 150, 255, 0.75), rgba(150, 110, 250, 0.6))',
    border: '1px solid rgba(255, 255, 255, 0.28)',
    borderRadius: 999,
    boxShadow: '0 0 8px rgba(76, 110, 245, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.35)'
  }
} as const;

/** Scrolls its content only when taller than `maxHeight`. The scrollbar sits in
 *  the menu's own padding (`bleed` px), so nothing shifts when it appears. */
export function GlassScroll({
  maxHeight,
  bleed = 7,
  children
}: {
  maxHeight: number;
  bleed?: number;
  children: React.ReactNode;
}) {
  return (
    <ScrollArea.Autosize
      mah={Math.max(48, Math.floor(maxHeight))}
      type="auto"
      scrollbarSize={5}
      scrollHideDelay={600}
      styles={glassScrollStyles}
      style={{ marginRight: -bleed }}
    >
      <div style={{ paddingRight: bleed }}>{children}</div>
    </ScrollArea.Autosize>
  );
}

// ---- Glass segmented control (Fit / Stretch / Actual / Custom, Rotate) -------
// Translucent track + a glowing glass "pill" for the active option.
const glassSegmentedStyles = {
  root: {
    background: 'rgba(128, 128, 128, 0.14)',
    border: '1px solid rgba(255, 255, 255, 0.10)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 10,
    padding: 3,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)'
  },
  indicator: {
    background: 'linear-gradient(135deg, rgba(92, 124, 250, 0.55), rgba(132, 94, 247, 0.45))',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: 8,
    boxShadow: '0 2px 10px rgba(76, 110, 245, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)'
  },
  control: {
    border: 'none'
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 6px',
    cursor: 'pointer',
    transition: 'color 160ms ease'
  }
} as const;

export function GlassSegmented({
  value,
  onChange,
  data
}: {
  value: string;
  onChange: (v: string) => void;
  data: { value: string; label: string }[];
}) {
  return (
    <SegmentedControl
      size="xs"
      fullWidth
      radius="md"
      transitionDuration={180}
      value={value}
      onChange={onChange}
      data={data}
      styles={glassSegmentedStyles}
    />
  );
}

// ---- Collapsible section + slider ------------------------------------------

export function EffectSection({
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

export function FxSlider({
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
  // Hover + scroll adjusts just this slider.
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

// ---- Greys out (and blocks) a control while its modular option is on ---------

export function Dim({ off, children }: { off: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-disabled={off}
      style={{
        opacity: off ? 0.35 : 1,
        pointerEvents: off ? 'none' : 'auto',
        transition: 'opacity 160ms ease'
      }}
    >
      {children}
    </div>
  );
}

// ---- Modular option: checkbox + min/max range + a return button -------------

export function ModularControls({
  label,
  description,
  on,
  onToggle,
  min,
  max,
  defMin,
  defMax,
  onRange,
  color = 'indigo',
  format
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  min: number;
  max: number;
  defMin: number;
  defMax: number;
  onRange: (min: number, max: number) => void;
  color?: string;
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => v.toFixed(2));
  const changed = min !== defMin || max !== defMax;
  return (
    <div onWheel={(e) => e.stopPropagation()}>
      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Text size="xs" fw={600}>
            {label}
          </Text>
          <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
            {description}
          </Text>
        </div>
        <PillToggle on={on} onToggle={onToggle} color={color} />
      </Group>
      <Collapse in={on} transitionDuration={180}>
        <div style={{ paddingTop: 8 }}>
          <Group justify="space-between" mb={2} wrap="nowrap">
            <Text size="xs" c="dimmed">
              Range
            </Text>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" style={{ fontFamily: 'monospace' }}>
                {fmt(min)} to {fmt(max)}
              </Text>
              {changed && (
                <Tooltip label={`Return to ${fmt(defMin)} to ${fmt(defMax)}`} withinPortal>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color={color}
                    aria-label="Return range to default"
                    onClick={() => onRange(defMin, defMax)}
                  >
                    <IconArrowBackUp size={12} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Group>
          <RangeSlider
            size="xs"
            min={MODULAR_MIN}
            max={MODULAR_MAX}
            step={MODULAR_STEP}
            minRange={0}
            value={[min, max]}
            onChange={([a, b]) => onRange(snapModular(a), snapModular(b))}
            label={(v) => fmt(v)}
            marks={[{ value: 1 }]}
            color={color}
            styles={{ thumb: sliderThumbStyle }}
          />
        </div>
      </Collapse>
    </div>
  );
}

// ---- The merged Speed / Pitch / Effects menu -------------------------------

export interface SectionAccordion {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

export interface PlayerSettingsMenuProps {
  speed: number;
  onSpeed: (s: number) => void;
  /** Modular pitch: random pitch + speed each time the sound plays or loops. Omit to hide it. */
  modular?: ModularSettings;
  onModular?: (m: ModularSettings) => void;
  /** True when something in the extra sections is active (lights the button). */
  extraActive?: boolean;
  opened: boolean;
  onOpenedChange: (open: boolean) => void;
  /** The player's root element. The menu re-measures its height when it resizes. */
  watchRef: React.RefObject<HTMLElement | null>;
  /** Optional, for players that need the button element (click-outside checks). */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  /** Hover + scroll on the button: +1 = faster, -1 = slower. */
  onWheelSpeed?: (dir: 1 | -1) => void;
  /** Set false when the player closes the menu itself (AudioPlayer does). */
  closeOnClickOutside?: boolean;
  /** True while an I / F shortcut closes the menu: no fade-out, so it is gone before the window resizes. */
  instantClose?: boolean;
  /** Extra collapsible sections (audio: EQ + reverb; video: video fx, scale, audio fx). */
  extraSections?: (acc: SectionAccordion) => React.ReactNode;
}

// Menus stay on top of their button and never flip below it: their height is
// capped to the room above instead (see useMenuMaxHeight / GlassScroll).
const MENU_MIDDLEWARES = { flip: false, shift: true } as const;

export function PlayerSettingsMenu({
  speed,
  onSpeed,
  modular,
  onModular,
  extraActive = false,
  opened,
  onOpenedChange,
  watchRef,
  buttonRef,
  onWheelSpeed,
  closeOnClickOutside = true,
  instantClose = false,
  extraSections
}: PlayerSettingsMenuProps) {
  const ownBtnRef = useRef<HTMLButtonElement | null>(null);
  const btnRef = buttonRef ?? ownBtnRef;
  const maxH = useMenuMaxHeight(opened, btnRef, watchRef);

  // Accordion: opening one section closes the others.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const acc: SectionAccordion = {
    isOpen: (id) => openSection === id,
    toggle: (id) => setOpenSection((cur) => (cur === id ? null : id))
  };

  const speedActive = speed !== 1;
  const pitchOn = !!modular?.pitchOn;
  const speedOn = !!modular?.speedOn;
  const volumeOn = !!modular?.volumeOn;
  const active =
    speedActive || pitchOn || speedOn || volumeOn || extraActive;

  const onWheel = (e: React.WheelEvent) => {
    if (!onWheelSpeed) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) onWheelSpeed(1);
    else if (e.deltaY > 0) onWheelSpeed(-1);
  };

  return (
    <Popover
      width={280}
      position="top"
      shadow="md"
      withArrow={false}
      opened={opened}
      onChange={onOpenedChange}
      closeOnClickOutside={closeOnClickOutside}
      transitionProps={instantClose ? { duration: 0, exitDuration: 0 } : undefined}
      middlewares={MENU_MIDDLEWARES}
      classNames={{ dropdown: PLAYER_GLASS_POPOVER_CLASS }}
    >
      <Popover.Target>
        <Tooltip label={`Speed ${speed}x · Pitch · Effects (J/K/L, or scroll for speed)`} withinPortal>
          <ActionIcon
            ref={btnRef}
            variant={active ? 'filled' : 'subtle'}
            color={active ? 'violet' : 'gray'}
            size="md"
            aria-label="Speed, pitch and effects"
            onClick={() => onOpenedChange(!opened)}
            onWheel={onWheel}
          >
            <IconAdjustmentsHorizontal size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown style={{ padding: '8px 10px' }}>
        <GlassScroll maxHeight={maxH - 20}>
          {/* Speed: one bar with the preset steps. Click / drag it, or click it and use the arrow keys. */}
          <EffectSection
            title="Speed"
            open={acc.isOpen('speed')}
            onToggle={() => acc.toggle('speed')}
            active={speedActive}
            onReset={() => onSpeed(1)}
          >
            <Dim off={speedOn}>
              <SpeedBar speed={speed} onSpeed={onSpeed} />
            </Dim>
          </EffectSection>

          {/* Modular Changes: random volume / pitch / speed each time the sound plays or loops. */}
          {modular && onModular && (
            <>
              <Divider my={4} />
              <EffectSection
                title="Modular Changes"
                open={acc.isOpen('modular')}
                onToggle={() => acc.toggle('modular')}
                active={pitchOn || speedOn || volumeOn}
                onReset={() => onModular({ ...DEFAULT_MODULAR })}
              >
                <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
                  Picks a new random value every time the sound plays or loops. While one is on, it
                  replaces its normal control.
                </Text>
                <Divider />
                <ModularControls
                  label="Volume"
                  description="Random volume each time the sound plays or loops."
                  on={modular.volumeOn}
                  onToggle={(on) => onModular({ ...modular, volumeOn: on })}
                  min={modular.volumeMin}
                  max={modular.volumeMax}
                  defMin={DEFAULT_MODULAR.volumeMin}
                  defMax={DEFAULT_MODULAR.volumeMax}
                  onRange={(a, b) => onModular({ ...modular, volumeMin: a, volumeMax: b })}
                  color="teal"
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Divider />
                <ModularControls
                  label="Pitch"
                  description="Random pitch each time the sound plays or loops (between range A and B)."
                  on={modular.pitchOn}
                  onToggle={(on) => onModular({ ...modular, pitchOn: on })}
                  min={modular.pitchMin}
                  max={modular.pitchMax}
                  defMin={DEFAULT_MODULAR.pitchMin}
                  defMax={DEFAULT_MODULAR.pitchMax}
                  onRange={(a, b) => onModular({ ...modular, pitchMin: a, pitchMax: b })}
                  color="violet"
                />
                <Divider />
                <ModularControls
                  label="Speed"
                  description="Random speed each time the sound plays or loops."
                  on={modular.speedOn}
                  onToggle={(on) => onModular({ ...modular, speedOn: on })}
                  min={modular.speedMin}
                  max={modular.speedMax}
                  defMin={DEFAULT_MODULAR.speedMin}
                  defMax={DEFAULT_MODULAR.speedMax}
                  onRange={(a, b) => onModular({ ...modular, speedMin: a, speedMax: b })}
                  color="indigo"
                />
              </EffectSection>
            </>
          )}

          {extraSections?.(acc)}
        </GlassScroll>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Pill-shaped on / off button. Used instead of checkboxes. */
export function PillToggle({
  on,
  onToggle,
  color = 'indigo',
  onLabel = 'On',
  offLabel = 'Off',
  disabled = false
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  color?: string;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      size="compact-xs"
      radius="xl"
      variant={on ? 'filled' : 'light'}
      color={on ? color : 'gray'}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      style={{ minWidth: 44, flexShrink: 0 }}
    >
      {on ? onLabel : offLabel}
    </Button>
  );
}

/** Speed as ONE bar. Click or drag it, or click it once and use the arrow keys
 *  (Left / Right / Up / Down) to step through SPEED_PRESETS. Scroll over it works too. */
export function SpeedBar({ speed, onSpeed }: { speed: number; onSpeed: (s: number) => void }) {
  let idx = 0;
  let best = Infinity;
  SPEED_PRESETS.forEach((s, i) => {
    const d = Math.abs(s - speed);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  const last = SPEED_PRESETS.length - 1;
  const shown = SPEED_PRESETS[idx];
  const color = getSpeedColor(shown) ?? 'indigo';
  const LABELLED = [0.25, 0.5, 1, 2, 4];
  const marks = SPEED_PRESETS.map((s, i) => ({
    value: i,
    label: LABELLED.includes(s) ? `${s}x` : undefined
  }));

  const step = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(last, idx + dir));
    if (next !== idx) onSpeed(SPEED_PRESETS[next]);
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) step(1);
    else if (e.deltaY > 0) step(-1);
  };

  return (
    <div
      onWheel={onWheel}
      onKeyDown={(e) => {
        if (e.key.startsWith('Arrow')) e.stopPropagation();
      }}
    >
      <Group justify="space-between" mb={2} wrap="nowrap">
        <Text size="xs" c="dimmed">
          Speed
        </Text>
        <Text size="xs" style={{ fontFamily: 'monospace' }}>
          {shown}x
        </Text>
      </Group>
      <Slider
        size="xs"
        min={0}
        max={last}
        step={1}
        value={idx}
        onChange={(i) => onSpeed(SPEED_PRESETS[i])}
        label={(i) => `${SPEED_PRESETS[i]}x`}
        marks={marks}
        color={color}
        mb={22}
        styles={{ thumb: sliderThumbStyle, markLabel: { fontSize: 10 } }}
      />
    </div>
  );
}

// ---- Presets: reverb + EQ -----------------------------------------------------
// Both players use these inside their "Audio Effects" section. The preset lists,
// the Custom values and the saved presets live in the store in playerShared.ts.

// Unselected pills in the light / pastel themes: the default pale text is hard to read there.
// (Dark themes keep the original look.)
const PILL_OFF_LIGHT = {
  color: 'var(--mantine-color-text, #1f2933)',
  backgroundColor: 'rgba(0, 0, 0, 0.07)',
  border: '1px solid rgba(0, 0, 0, 0.14)'
} as React.CSSProperties;

/** A row of preset pills; the selected one is filled. */
export function PresetPills({
  items,
  selected,
  onSelect,
  color = 'indigo'
}: {
  items: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
  color?: string;
}) {
  const light = useComputedColorScheme('dark') === 'light';
  return (
    <Group gap={6}>
      {items.map((it) => {
        const on = it.id === selected;
        return (
          <Button
            key={it.id}
            size="compact-xs"
            radius="xl"
            variant={on ? 'filled' : 'light'}
            color={on ? color : 'gray'}
            aria-pressed={on}
            style={light && !on ? PILL_OFF_LIGHT : undefined}
            onClick={() => onSelect(it.id)}
          >
            {it.name}
          </Button>
        );
      })}
    </Group>
  );
}

/** Small title row: name, the current preset, an optional icon button, and Reset. */
function SubHeader({
  title,
  hint,
  active,
  onReset,
  action
}: {
  title: string;
  hint?: string;
  active: boolean;
  onReset: () => void;
  action?: React.ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap={6}>
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text size="xs" fw={600}>
          {title}
        </Text>
        {hint && (
          <Text size="10px" c="dimmed" truncate>
            {hint}
          </Text>
        )}
      </Group>
      <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
        {action}
        <UnstyledButton onClick={onReset} disabled={!active}>
          <Text size="xs" c={active ? 'indigo' : 'dimmed'}>
            Reset
          </Text>
        </UnstyledButton>
      </Group>
    </Group>
  );
}

/** "Save as preset": a button that turns into a name box + Save. */
export function SavePresetRow({
  onSave,
  color = 'indigo'
}: {
  onSave: (name: string) => void;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName('');
    setOpen(false);
  };
  if (!open) {
    return (
      <Button
        size="compact-xs"
        radius="xl"
        variant="light"
        color={color}
        leftSection={<IconDeviceFloppy size={12} />}
        onClick={() => setOpen(true)}
        style={{ alignSelf: 'flex-start' }}
      >
        Save as preset
      </Button>
    );
  }
  return (
    <Group gap={6} wrap="nowrap">
      <TextInput
        size="xs"
        placeholder="Preset name"
        value={name}
        maxLength={24}
        autoFocus
        style={{ flex: 1 }}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') submit();
        }}
      />
      <Button size="compact-xs" radius="xl" color={color} onClick={submit} disabled={!name.trim()}>
        Save
      </Button>
      <ActionIcon
        size="xs"
        variant="subtle"
        color="gray"
        aria-label="Cancel"
        onClick={() => {
          setOpen(false);
          setName('');
        }}
      >
        <IconX size={12} />
      </ActionIcon>
    </Group>
  );
}

function DeletePresetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="compact-xs"
      radius="xl"
      variant="subtle"
      color="red"
      leftSection={<IconTrash size={12} />}
      onClick={onClick}
      style={{ alignSelf: 'flex-start' }}
    >
      Delete preset
    </Button>
  );
}

/** Reverb: preset pills (Custom last), a Mix slider, and, for Custom, its own sliders
 *  plus "Save as preset". Custom keeps its values while you try other presets. */
export function ReverbControls({ wet, onWet }: { wet: number; onWet: (v: number) => void }) {
  const fx = useFxPresets();
  const id = fx.reverbId;
  const items = [
    ...REVERB_PRESETS.map((p) => ({ id: p.id, name: p.name })),
    ...fx.userReverb.map((p) => ({ id: p.id, name: p.name })),
    { id: 'custom', name: 'Custom' }
  ];
  const current = items.find((i) => i.id === id);
  const isUser = fx.userReverb.some((p) => p.id === id);
  const c = fx.reverbCustom;
  const [listOpen, setListOpen] = useState(false);
  const setCustom = (patch: Partial<ReverbParams>) => fxActions.setReverbCustom({ ...c, ...patch });
  return (
    <Stack gap="xs">
      <SubHeader
        title="Reverb"
        hint={current?.name}
        active={wet > 0}
        onReset={() => onWet(0)}
        action={
          <Tooltip label="Reverb presets" withinPortal>
            <ActionIcon
              size="xs"
              variant={listOpen ? 'light' : 'subtle'}
              color={listOpen ? 'violet' : 'gray'}
              aria-label="Reverb presets"
              onClick={() => setListOpen((o) => !o)}
            >
              <IconWaveSine size={14} />
            </ActionIcon>
          </Tooltip>
        }
      />
      <Collapse in={listOpen} transitionDuration={180}>
        <Stack gap="xs" pb={4}>
          <PresetPills
            items={items}
            selected={id}
            color="violet"
            onSelect={(pid) => {
              fxActions.setReverbId(pid);
              // Reverb at 0% is silent, so picking a preset turns it up a little.
              if (wet === 0) onWet(0.3);
            }}
          />
        </Stack>
      </Collapse>
      <FxSlider
        label="Mix"
        display={`${Math.round(wet * 100)}%`}
        value={wet}
        min={0}
        max={1}
        step={0.05}
        color="violet"
        onChange={onWet}
      />
      {listOpen && id === 'custom' && (
        <>
          <FxSlider
            label="Decay time"
            display={`${c.time.toFixed(1)} s`}
            value={c.time}
            min={REVERB_TIME_MIN}
            max={REVERB_TIME_MAX}
            step={0.1}
            color="violet"
            onChange={(v) => setCustom({ time: v })}
          />
          <FxSlider
            label="Damping (dark to bright)"
            display={`${Math.round(c.damping * 100)}%`}
            value={c.damping}
            min={0}
            max={1}
            step={0.05}
            color="violet"
            onChange={(v) => setCustom({ damping: v })}
          />
          <FxSlider
            label="Pre-delay"
            display={`${Math.round(c.preDelay)} ms`}
            value={c.preDelay}
            min={0}
            max={REVERB_PREDELAY_MAX}
            step={1}
            color="violet"
            onChange={(v) => setCustom({ preDelay: v })}
          />
          <SavePresetRow color="violet" onSave={(name) => fxActions.saveReverbPreset(name)} />
        </>
      )}
      {listOpen && isUser && (
        <DeletePresetButton onClick={() => fxActions.deleteReverbPreset(id)} />
      )}
    </Stack>
  );
}

const EQ_BANDS: { key: keyof EqValues; label: string; hint: string }[] = [
  { key: 'subBass', label: 'Sub Bass', hint: '~60 Hz' },
  { key: 'bass', label: 'Bass', hint: '~150 Hz' },
  { key: 'treble', label: 'Treble', hint: '~6 kHz' }
];

/** Equalizer: three sliders. The icon button left of Reset opens the preset list
 *  (built-in, saved, Custom last). Moving a slider switches to Custom and remembers it. */
export function EqControls({
  values,
  onChange
}: {
  values: EqValues;
  onChange: (v: EqValues) => void;
}) {
  const fx = useFxPresets();
  const [listOpen, setListOpen] = useState(false);
  const all = [...EQ_PRESETS, ...fx.userEq];
  const match = all.find((p) => sameEq(p.values, values));
  const selected = match ? match.id : 'custom';
  const items = [...all.map((p) => ({ id: p.id, name: p.name })), { id: 'custom', name: 'Custom' }];
  const isUser = fx.userEq.some((p) => p.id === selected);

  // Keeps Custom in step when the sliders were set from elsewhere (older saves, a reset).
  useEffect(() => {
    if (selected === 'custom' && !sameEq(values, fx.eqCustom)) fxActions.setEqCustom(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, values.subBass, values.bass, values.treble, fx.eqCustom]);

  const pick = (pid: string) => {
    if (pid === 'custom') {
      onChange({ ...fx.eqCustom });
      return;
    }
    const p = all.find((x) => x.id === pid);
    if (p) onChange({ ...p.values });
  };
  const edit = (key: keyof EqValues, v: number) => {
    const next = { ...values, [key]: v };
    fxActions.setEqCustom(next);
    onChange(next);
  };

  return (
    <Stack gap="xs">
      <SubHeader
        title="Equalizer"
        hint={match ? match.name : 'Custom'}
        active={!sameEq(values, EQ_FLAT)}
        onReset={() => onChange({ ...EQ_FLAT })}
        action={
          <Tooltip label="EQ presets" withinPortal>
            <ActionIcon
              size="xs"
              variant={listOpen ? 'light' : 'subtle'}
              color={listOpen ? 'teal' : 'gray'}
              aria-label="EQ presets"
              onClick={() => setListOpen((o) => !o)}
            >
              <IconChartBar size={14} />
            </ActionIcon>
          </Tooltip>
        }
      />
      <Collapse in={listOpen} transitionDuration={180}>
        <Stack gap="xs" pb={4}>
          <PresetPills items={items} selected={selected} color="teal" onSelect={pick} />
          {selected === 'custom' && (
            <SavePresetRow
              color="teal"
              onSave={(name) => fxActions.saveEqPreset(name, values)}
            />
          )}
          {isUser && <DeletePresetButton onClick={() => fxActions.deleteEqPreset(selected)} />}
        </Stack>
      </Collapse>
      {EQ_BANDS.map((b) => (
        <FxSlider
          key={b.key}
          label={`${b.label} (${b.hint})`}
          display={formatDb(values[b.key])}
          value={values[b.key]}
          min={-EQ_MAX_DB}
          max={EQ_MAX_DB}
          step={1}
          color="teal"
          onChange={(v) => edit(b.key, v)}
          marks={[{ value: 0 }]}
        />
      ))}
    </Stack>
  );
}
