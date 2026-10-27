import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  useMantineColorScheme
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAppWindow,
  IconCheck,
  IconCoffee,
  IconDatabase,
  IconDownload,
  IconUpload,
  IconInfoCircle,
  IconBrandGithub,
  IconRefresh,
  IconFileText,
  IconFolderOpen,
  IconMoon,
  IconPalette,
  IconSparkles,
  IconSun,
  IconTrash
} from '@tabler/icons-react';
import type {
  ExternalAppRegistration,
  LogLevel,
  PreferencesFile,
  Unit
} from '@shared/preferences';
import { LOG_LEVELS, normalizeExtension } from '@shared/preferences';
import {
  DEFAULT_RENDER_QUALITY,
  RENDER_QUALITY_PRESETS,
  getRenderQualityPreset,
  type RenderQuality
} from '@shared/render-quality';
import { ipc } from '../ipc-client';
import { savePreferences, usePreferences } from '../util/use-preferences';
import { THEMES, DEFAULT_THEME_ID } from '../themes';

// Quick-pick file types for the "Add an external app" form, so an app like
// Photoshop or Audacity can be registered without typing every extension.
// Keep in sync with the formats the scanner supports (README: "Supported File
// Formats").
const EXTENSION_GROUPS = [
  { id: '3d', label: '3D models', extensions: ['fbx', 'gltf', 'glb', 'obj', 'stl', 'ply', '3mf'] },
  { id: 'image', label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] },
  { id: 'audio', label: 'Audio', extensions: ['wav', 'mp3', 'flac'] },
  { id: 'text', label: 'Text & notes', extensions: ['txt', 'md'] }
] as const;

type ExtensionGroup = (typeof EXTENSION_GROUPS)[number];

/** Theme ids match the `id` field in themes/dark.ts and themes/light.ts. */
type ThemeId = string;

/** Parses the comma-separated draft into normalized, de-duplicated extensions. */
function parseExtensions(draft: string): string[] {
  const seen = new Set<string>();
  for (const raw of draft.split(',')) {
    const ext = normalizeExtension(raw);
    if (ext) seen.add(ext);
  }
  return [...seen];
}

/* -------------------------------------------------------------------------- */
/*  Glass + pill styling                                                      */
/*                                                                            */
/*  The modal is an acrylic panel: a translucent tint over a heavy backdrop   */
/*  blur, with every inner surface also translucent so the glass reads all    */
/*  the way through. Shapes are fully rounded. Colors are CSS variables       */
/*  scoped to .gam-root: dark by default, light when Mantine's color scheme   */
/*  is light. The accent comes from --wh3d-waveform-played (dark.ts/light.ts).*/
/* -------------------------------------------------------------------------- */

const T = {
  text: 'var(--gam-text)',
  dim: 'var(--gam-dim)',
  danger: 'var(--gam-danger)'
} as const;

const MODAL_CSS = `
.gam-root {
  --gam-accent: var(--wh3d-waveform-played, #4c6ef5);
  --gam-on-accent: #ffffff;
  --gam-glass: rgba(28, 29, 34, 0.6);
  --gam-edge: rgba(255, 255, 255, 0.14);
  --gam-header: rgba(0, 0, 0, 0.22);
  --gam-window: transparent;
  --gam-panel: rgba(255, 255, 255, 0.06);
  --gam-panel2: rgba(255, 255, 255, 0.09);
  --gam-field: rgba(0, 0, 0, 0.32);
  --gam-field-bd: rgba(255, 255, 255, 0.08);
  --gam-hover: rgba(255, 255, 255, 0.1);
  --gam-text: #ececee;
  --gam-dim: #a4a6ad;
  --gam-danger: #ff6b6b;
  background: var(--gam-glass) !important;
  -webkit-backdrop-filter: blur(30px) saturate(170%);
  backdrop-filter: blur(30px) saturate(170%);
  border: 1px solid var(--gam-edge);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--gam-text);
  font-family: Roboto, "Segoe UI", system-ui, sans-serif;
}
:root[data-mantine-color-scheme='light'] .gam-root {
  --gam-glass: rgba(246, 247, 250, 0.62);
  --gam-edge: rgba(255, 255, 255, 0.7);
  --gam-header: rgba(255, 255, 255, 0.4);
  --gam-panel: rgba(255, 255, 255, 0.55);
  --gam-panel2: rgba(0, 0, 0, 0.05);
  --gam-field: rgba(255, 255, 255, 0.8);
  --gam-field-bd: rgba(0, 0, 0, 0.12);
  --gam-hover: rgba(0, 0, 0, 0.06);
  --gam-text: #16171a;
  --gam-dim: #565a62;
  --gam-danger: #d92d2d;
  box-shadow: 0 24px 64px rgba(30, 40, 70, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

/* Title bar */
.gam-root .mantine-Modal-header {
  background: var(--gam-header);
  padding: 14px 14px 10px 24px;
  min-height: 0;
}
.gam-root .mantine-Modal-title { font-size: 15px; font-weight: 600; color: var(--gam-text); }
.gam-root .mantine-Modal-close { border-radius: 50%; color: var(--gam-dim); }
.gam-root .mantine-Modal-close:hover { background: var(--gam-hover); color: var(--gam-text); }
.gam-root .mantine-Modal-body { padding: 0; }

/* Pill tabs */
.gam-root .mantine-Tabs-list {
  flex-wrap: nowrap;
  overflow-x: auto;
  background: var(--gam-header);
  padding: 0 16px 10px;
  gap: 4px;
}
.gam-root .mantine-Tabs-tab {
  flex: 0 0 auto;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--gam-dim);
  border-radius: 999px;
  transition: background 120ms ease, color 120ms ease;
}
.gam-root .mantine-Tabs-tab:hover { background: var(--gam-hover); color: var(--gam-text); }
.gam-root .mantine-Tabs-tab[data-active] {
  background: color-mix(in srgb, var(--gam-accent) 26%, transparent);
  color: var(--gam-text);
}
.gam-root .mantine-Tabs-tab[data-active] .mantine-Tabs-tabSection { color: var(--gam-accent); }
.gam-root .mantine-Tabs-tabSection { margin-inline-end: 6px !important; }
.gam-root .mantine-Tabs-tab:focus-visible { outline: 2px solid var(--gam-accent); outline-offset: 1px; }
.gam-root .mantine-Tabs-panel { background: var(--gam-window); padding: 16px; min-height: 420px; }

/* Categories and property rows */
.gam-cat { border-radius: 22px; overflow: hidden; background: var(--gam-panel); }
.gam-cat-head {
  background: var(--gam-header);
  padding: 9px 18px;
  font-size: 12px;
  font-weight: 700;
  color: var(--gam-text);
}
.gam-cat-body { padding: 6px; }
.gam-prop {
  display: grid;
  grid-template-columns: minmax(0, 36%) minmax(0, 1fr);
  align-items: center;
  column-gap: 16px;
  padding: 8px 12px;
  border-radius: 16px;
}
.gam-prop:hover { background: var(--gam-hover); }
.gam-prop-wide { grid-template-columns: minmax(0, 1fr); row-gap: 8px; }
.gam-prop-value { justify-self: end; font-size: 12px; font-weight: 500; color: var(--gam-text); }
.gam-note { padding: 8px 12px; }
.gam-row {
  background: var(--gam-panel2);
  border-radius: 18px;
  padding: 10px 14px;
}

/* Buttons */
.gam-root .mantine-Button-root { border-radius: 999px; font-weight: 500; font-size: 12px; letter-spacing: 0; }
.gam-btn-primary {
  --button-bg: var(--gam-accent) !important;
  --button-hover: color-mix(in srgb, var(--gam-accent) 85%, white) !important;
  --button-color: var(--gam-on-accent) !important;
  --button-bd: 1px solid transparent !important;
}
.gam-btn-flat {
  --button-bg: var(--gam-panel2) !important;
  --button-hover: var(--gam-hover) !important;
  --button-color: var(--gam-text) !important;
  --button-bd: 1px solid transparent !important;
}
.gam-btn-ghost {
  --button-bg: transparent !important;
  --button-hover: var(--gam-hover) !important;
  --button-color: var(--gam-accent) !important;
  --button-bd: 1px solid transparent !important;
}
.gam-root .mantine-Button-root:focus-visible { outline: 2px solid var(--gam-accent); outline-offset: 2px; }
.gam-root .mantine-Button-root[data-disabled],
.gam-root .mantine-Button-root:disabled { opacity: 0.45; }

/* Toggle chips for file types */
.gam-root .gam-chip {
  --button-bg: var(--gam-panel2) !important;
  --button-hover: var(--gam-hover) !important;
  --button-color: var(--gam-text) !important;
  --button-bd: 1px solid transparent !important;
}
.gam-root .gam-chip[data-on] {
  --button-bg: var(--gam-accent) !important;
  --button-hover: color-mix(in srgb, var(--gam-accent) 85%, white) !important;
  --button-color: var(--gam-on-accent) !important;
}

/* Segmented pills: no separators */
.gam-root .gam-seg {
  background: var(--gam-field);
  border: none;
  border-radius: 999px;
  --sc-radius: 999px !important;
}
.gam-root .gam-seg .mantine-SegmentedControl-control::before { display: none !important; }
.gam-root .gam-seg .mantine-SegmentedControl-control { border: none !important; }
.gam-root .gam-seg .mantine-SegmentedControl-indicator {
  background: var(--gam-accent) !important;
  box-shadow: none !important;
  border-radius: 999px !important;
}
.gam-root .gam-seg .mantine-SegmentedControl-label {
  color: var(--gam-dim);
  font-size: 12px;
  font-weight: 500;
  border-radius: 999px;
  text-transform: none;
}
.gam-root .gam-seg .mantine-SegmentedControl-label:hover { color: var(--gam-text); }
.gam-root .gam-seg .mantine-SegmentedControl-label[data-active] { color: var(--gam-on-accent) !important; }

/* Slider */
.gam-root .mantine-Slider-track::before { background: var(--gam-field); }
.gam-root .mantine-Slider-bar { background: var(--gam-accent); }
.gam-root .mantine-Slider-thumb { border-color: var(--gam-accent); background: var(--gam-on-accent); }

/* Checkbox */
.gam-root .mantine-Checkbox-input {
  background: var(--gam-field);
  border: 1px solid var(--gam-dim);
  border-radius: 6px;
}
.gam-root .mantine-Checkbox-input:checked {
  background: var(--gam-accent);
  border-color: var(--gam-accent);
}
.gam-root .mantine-Checkbox-icon { color: var(--gam-on-accent); }
.gam-root .mantine-Checkbox-label { color: var(--gam-text); font-size: 12px; }

/* Pill text fields */
.gam-root .mantine-TextInput-input {
  background: var(--gam-field);
  border: 1px solid var(--gam-field-bd);
  border-radius: 999px;
  padding-inline: 16px;
  color: var(--gam-text);
  font-size: 12px;
}
.gam-root .mantine-TextInput-input:focus { border-color: var(--gam-accent); }
.gam-root .mantine-TextInput-label { color: var(--gam-text); font-size: 12px; font-weight: 500; margin-bottom: 4px; }
.gam-root .mantine-TextInput-description { color: var(--gam-dim); font-size: 11px; margin-bottom: 6px; }

/* Tags */
.gam-root .mantine-Badge-root {
  text-transform: none;
  border-radius: 999px;
  font-weight: 500;
  letter-spacing: 0;
  background: var(--gam-panel2) !important;
  color: var(--gam-text) !important;
  border: none !important;
}

.gam-step {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--gam-accent);
  color: var(--gam-on-accent);
}
.gam-root code {
  background: var(--gam-panel2);
  color: var(--gam-text);
  border-radius: 999px;
  padding: 1px 8px;
}
.gam-footer {
  background: var(--gam-header);
  padding: 10px 18px;
  display: flex;
  justify-content: center;
}

/* Theme cards (fixed colors: each card previews its own theme) */
.gam-theme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 6px;
}
.gam-theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  min-height: 150px;
  padding: 16px 18px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  border-radius: 26px;
  border: 2px solid transparent;
  transition: box-shadow 140ms ease, border-color 140ms ease, transform 140ms ease;
}
.gam-theme-card:hover { transform: translateY(-1px); }
.gam-theme-card:focus-visible { outline: 2px solid var(--gam-accent); outline-offset: 3px; }
.gam-theme-card[aria-checked='true'] {
  border-color: var(--gam-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--gam-accent) 28%, transparent);
}
.gam-theme-dark { background: #1b1c20; color: #ececee; }
.gam-theme-light { background: #f6f7f9; color: #16171a; }
.gam-theme-icon {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.gam-theme-dark .gam-theme-icon { background: rgba(255, 255, 255, 0.1); color: #b4bdff; }
.gam-theme-light .gam-theme-icon { background: rgba(0, 0, 0, 0.07); color: #e8890c; }
.gam-theme-bars { display: flex; flex-direction: column; gap: 5px; margin-top: 2px; }
.gam-theme-bars i { display: block; height: 6px; border-radius: 999px; background: currentColor; opacity: 0.14; }
.gam-theme-bars i:nth-child(1) { width: 70%; }
.gam-theme-bars i:nth-child(2) { width: 100%; }
.gam-theme-bars i:nth-child(3) { width: 45%; }
.gam-theme-check {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--gam-accent);
  color: var(--gam-on-accent);
}

@media (prefers-reduced-motion: reduce) {
  .gam-root * { transition: none !important; }
  .gam-theme-card:hover { transform: none; }
}
`;

/* -------------------------------------------------------------------------- */
/*  Building blocks                                                           */
/* -------------------------------------------------------------------------- */

function Note({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c={T.dim} lh={1.6}>
      {children}
    </Text>
  );
}

/** A category from the details panel: header strip + rows. */
function Category({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gam-cat">
      <div className="gam-cat-head">{title}</div>
      <div className="gam-cat-body">{children}</div>
    </div>
  );
}

/** One property row: label (and optional hint) on the left, control on the right. */
function Property({
  label,
  hint,
  wide,
  children
}: {
  label: string;
  hint?: ReactNode;
  /** Stack the control under the label (for wide controls like segmented groups). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'gam-prop gam-prop-wide' : 'gam-prop'}>
      <Stack gap={1}>
        <Text size="xs" fw={500} c={T.text}>
          {label}
        </Text>
        {hint && (
          <Text size="xs" c={T.dim} lh={1.45} style={{ fontSize: 11 }}>
            {hint}
          </Text>
        )}
      </Stack>
      <div style={wide ? undefined : { justifySelf: 'end' }}>{children}</div>
    </div>
  );
}

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Active library id - used for cache management actions. */
  libraryId: string | null;
  /**
   * Active theme id ('dark' | 'light'). If omitted, it's read from Mantine's
   * color scheme attribute on <html>.
   */
  themeId?: string;
  /** Window opacity, 0.4 to 1. Below 1 the Windows 11 acrylic backdrop shows through. */
  windowOpacity?: number;
  /** Called while the opacity slider moves. */
  onWindowOpacityChange?: (value: number) => void;
  /** Called when a theme card is picked. Wire this to the app's theme switcher. */
  onThemeChange?: (id: ThemeId) => void;
}

/**
 * Tabbed settings modal. Each tab is a self-contained section that reads
 * from the live prefs and writes back via savePreferences (which broadcasts
 * to every usePreferences subscriber).
 */
export function PreferencesModal({
  opened,
  onClose,
  libraryId,
  themeId,
  onThemeChange
}: Props) {
  const { prefs, reload } = usePreferences();

  useEffect(() => {
    if (opened) void reload();
  }, [opened, reload]);

  if (!prefs) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Preferences"
      centered
      size="lg"
      radius={30}
      classNames={{ content: 'gam-root' }}
      overlayProps={{ color: '#000', opacity: 0.4, blur: 3 }}
    >
      <style>{MODAL_CSS}</style>

      <Tabs defaultValue="quality" keepMounted={false} variant="unstyled">
        <Tabs.List>
          <Tabs.Tab value="quality" leftSection={<IconSparkles size={16} />}>
            3D Quality
          </Tabs.Tab>
          <Tabs.Tab value="theme" leftSection={<IconPalette size={16} />}>
            Theme
          </Tabs.Tab>
          <Tabs.Tab value="apps" leftSection={<IconAppWindow size={16} />}>
            External apps
          </Tabs.Tab>
          <Tabs.Tab value="data" leftSection={<IconDatabase size={16} />}>
            Data
          </Tabs.Tab>
          <Tabs.Tab value="about" leftSection={<IconInfoCircle size={16} />}>
            About
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="quality">
          <RenderQualitySection prefs={prefs} />
        </Tabs.Panel>
        <Tabs.Panel value="theme">
          <ThemeSection
            prefs={prefs}
            themeId={themeId}
            onThemeChange={onThemeChange}
          />
        </Tabs.Panel>
        <Tabs.Panel value="apps">
          <ExternalAppsSection prefs={prefs} onChanged={reload} />
        </Tabs.Panel>
        <Tabs.Panel value="data">
          <Stack gap="md">
            <DataSection />
            <CacheSection libraryId={libraryId} />
            <LogsSection prefs={prefs} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="about">
          <AboutSection />
        </Tabs.Panel>
      </Tabs>

      <div className="gam-footer">
        <Button
          className="gam-btn-flat"
          size="xs"
          leftSection={<IconCoffee size={14} />}
          component="a"
          href="https://linktr.ee/ichbinaydin"
          target="_blank"
          rel="noreferrer"
        >
          Support Game Asset Manager: Check Out My Socials
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sections                                                                  */
/* -------------------------------------------------------------------------- */

function RenderQualitySection({ prefs }: { prefs: PreferencesFile }) {
  const current: RenderQuality = prefs.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const preset = getRenderQualityPreset(current);
  const apply = (next: string) => {
    void savePreferences({ ...prefs, renderQuality: next as RenderQuality });
  };
  return (
    <Stack gap="md">
      <Note>
        Affects the interactive 3D preview only - background thumbnail rendering always uses Low
        for speed and consistency.
      </Note>

      <Category title="Interactive preview">
        <Property label="Quality" wide>
          <SegmentedControl
            className="gam-seg"
            fullWidth
            size="xs"
            value={current}
            onChange={apply}
            data={RENDER_QUALITY_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Property>
        <div className="gam-note">
          <Text size="xs" c={T.text} lh={1.6}>
            {preset.description}
          </Text>
        </div>
      </Category>

      <Category title="Preset details">
        <Property label="Shadows">
          <span className="gam-prop-value">
            {preset.shadows.enabled
              ? `${preset.shadows.filter}, ${preset.shadows.mapSize}px`
              : 'Off'}
          </span>
        </Property>
        <Property label="Texture anisotropy">
          <span className="gam-prop-value">{preset.anisotropy}×</span>
        </Property>
        <Property label="Env-map blur">
          <span className="gam-prop-value">{preset.envMapRoughness}</span>
        </Property>
      </Category>

      <Note>Changing quality reloads the active preview.</Note>
    </Stack>
  );
}

function ThemeSection({
  prefs,
  themeId,
  onThemeChange
}: {
  prefs: PreferencesFile;
  themeId?: string;
  onThemeChange?: (id: ThemeId) => void;
}) {
  const { setColorScheme } = useMantineColorScheme();
  const active = themeId ?? DEFAULT_THEME_ID;
  const darkThemes = THEMES.filter((t) => t.colorScheme !== 'light');
  const lightThemes = THEMES.filter((t) => t.colorScheme === 'light');

  const renderCard = (t: (typeof THEMES)[number]) => {
    const vars = t.cssVars as Record<string, string>;
    const isLight = t.colorScheme === 'light';
    const bg = vars['--mantine-color-body'] ?? (isLight ? '#f6f7f9' : '#1b1c20');
    const fg = vars['--mantine-color-text'] ?? (isLight ? '#16171a' : '#ececee');
    const accent = vars['--wh3d-waveform-played'] ?? '#4c6ef5';
    return (
      <button
        key={t.id}
        type="button"
        role="radio"
        aria-checked={active === t.id}
        className="gam-theme-card"
        style={{
          background: bg,
          color: fg,
          width: 84,
          boxSizing: 'border-box',
          minHeight: 0,
          padding: '8px 8px',
          gap: 6,
          borderRadius: 16
        }}
        onClick={() => {
          setColorScheme(t.colorScheme);
          onThemeChange?.(t.id);
        }}
      >
        {active === t.id && (
          <span className="gam-theme-check" style={{ top: 6, right: 6, width: 16, height: 16 }}>
            <IconCheck size={10} stroke={3} />
          </span>
        )}
        <span
          className="gam-theme-icon"
          style={{
            width: 22,
            height: 22,
            background: 'rgba(128, 128, 128, 0.2)',
            color: accent
          }}
        >
          {isLight ? <IconSun size={13} /> : <IconMoon size={13} />}
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {t.label}
          </span>
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              height: 4,
              width: '60%',
              borderRadius: 999,
              marginTop: 4,
              background: accent,
              opacity: 0.8
            }}
          />
        </span>
      </button>
    );
  };

  const colLabel = (text: string) => (
    <Text size="xs" c={T.dim} fw={600} mb={6} style={{ letterSpacing: 0.4 }}>
      {text}
    </Text>
  );

  return (
    <Stack gap="md">
      <Note>Choose how Game Asset Manager looks. The change applies right away.</Note>

      <Category title="Appearance">
        <div
          role="radiogroup"
          aria-label="Theme"
          style={{
            display: 'flex',
            gap: 16,
            padding: 10,
            alignItems: 'flex-start',
            justifyContent: 'center'
          }}
        >
          <div>
            {colLabel('DARK')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 84px)', gap: 6 }}>
              {darkThemes.map(renderCard)}
            </div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--gam-edge)' }} />
          <div>
            {colLabel('LIGHT')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 84px)', gap: 6 }}>
              {lightThemes.map(renderCard)}
            </div>
          </div>
        </div>
      </Category>

      <UnitsCategory prefs={prefs} />
    </Stack>
  );
}
/** Display units, shown inside the Theme tab. */
function UnitsCategory({ prefs }: { prefs: PreferencesFile }) {
  const [unit, setUnit] = useState<Unit>(prefs.unit ?? 'mm');
  const apply = useCallback(
    async (next: Unit) => {
      setUnit(next);
      await savePreferences({ ...prefs, unit: next });
    },
    [prefs]
  );
  return (
    <Category title="Measurements">
      <Property
        label="Display units"
        hint="Unit used to show model sizes."
        wide
      >
        <SegmentedControl
          className="gam-seg"
          fullWidth
          size="xs"
          value={unit}
          onChange={(v) => void apply(v as Unit)}
          data={[
            { value: 'mm', label: 'Millimeters' },
            { value: 'in', label: 'Inches' }
          ]}
        />
      </Property>
    </Category>
  );
}

function CacheSection({ libraryId }: { libraryId: string | null }) {
  const [busy, setBusy] = useState<'rebuild' | 'purge' | null>(null);

  const rebuild = async () => {
    if (!libraryId) return;
    setBusy('rebuild');
    try {
      await ipc.rebuildThumbCache(libraryId);
      notifications.show({
        color: 'green',
        title: 'Cache rebuild queued',
        message: 'Thumbnails will re-render in the background.'
      });
    } finally {
      setBusy(null);
    }
  };

  const purge = async () => {
    if (!libraryId) return;
    setBusy('purge');
    try {
      const result = await ipc.purgeOrphanThumbs(libraryId);
      notifications.show({
        color: 'green',
        title: 'Orphan sidecars purged',
        message: `Removed ${result.removed} file${result.removed === 1 ? '' : 's'}.`
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="md">
      <Note>
        Manage the per-library thumbnail cache. These actions are scoped to the currently active
        library.
      </Note>
      <Category title="Thumbnail cache">
        <Property
          label="Rebuild thumbnail cache"
          hint="Wipes the thumbnails table and re-queues every file."
        >
          <Button
            className="gam-btn-flat"
            size="xs"
            loading={busy === 'rebuild'}
            disabled={!libraryId}
            onClick={() => void rebuild()}
          >
            Rebuild
          </Button>
        </Property>
        <Property
          label="Purge orphan sidecars"
          hint="Removes sidecar PNG/WebP files whose file_id no longer exists."
        >
          <Button
            className="gam-btn-flat"
            size="xs"
            loading={busy === 'purge'}
            disabled={!libraryId}
            onClick={() => void purge()}
          >
            Purge
          </Button>
        </Property>
      </Category>
    </Stack>
  );
}

function AboutSection() {
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof ipc.checkForUpdates>> | null>(
    null
  );

  useEffect(() => {
    void ipc
      .getAppVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      setResult(await ipc.checkForUpdates());
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Stack gap="md">
      <Note>Game Asset Manager is a browser and organizer for 3D models, images and audio.</Note>
      <Category title="About">
        <Property label="Version">
          <span className="gam-prop-value">{version || '...'}</span>
        </Property>
        <Property label="Source code" hint="Issues, releases and the full project.">
          <Button
            className="gam-btn-flat"
            size="xs"
            leftSection={<IconBrandGithub size={14} />}
            component="a"
            href="https://github.com/iam-aydin/Game-Asset-Manager"
            target="_blank"
            rel="noreferrer"
          >
            Open GitHub
          </Button>
        </Property>
      </Category>
      <Category title="Updates">
        <Property label="Check for updates" hint="Compares your version with the newest release.">
          <Button
            className="gam-btn-flat"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            loading={checking}
            onClick={() => void check()}
          >
            Check now
          </Button>
        </Property>
        {result && (
          <div className="gam-note">
            {!result.ok ? (
              <Text size="xs" c={T.danger}>
                Could not check: {result.error}
              </Text>
            ) : result.upToDate ? (
              <Text size="xs" c={T.text}>
                You have the newest version ({result.current}).
              </Text>
            ) : (
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c={T.text}>
                  Version {result.latest} is available. You have {result.current}.
                </Text>
                <Button
                  className="gam-btn-primary"
                  size="xs"
                  component="a"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </Button>
              </Group>
            )}
          </div>
        )}
      </Category>
    </Stack>
  );
}

function readLocalList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function DataSection() {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const doExport = async () => {
    setBusy('export');
    try {
      const r = await ipc.exportData({
        favorites: readLocalList('wh3d:favorites:global'),
        recent: readLocalList('wh3d:recent:global')
      });
      if (!r.ok) {
        notifications.show({ color: 'red', title: 'Export failed', message: r.error });
      } else if (!r.canceled) {
        notifications.show({ color: 'green', title: 'Data exported', message: r.path });
      }
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    setBusy('import');
    try {
      const r = await ipc.importData();
      if (!r.ok) {
        notifications.show({ color: 'red', title: 'Import failed', message: r.error });
        return;
      }
      if (r.canceled) return;
      const merge = (key: string, add: string[]) => {
        const next = [...new Set([...readLocalList(key), ...add])];
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // ignore
        }
      };
      merge('wh3d:favorites:global', r.local.favorites);
      merge('wh3d:recent:global', r.local.recent);
      notifications.show({
        color: 'green',
        title: 'Data imported',
        message:
          `${r.libraries} libraries, ${r.containers} containers.` +
          (r.pending > 0
            ? ` ${r.pending} files are still being scanned; ratings and tags for them apply when the scan finishes. Keep the app open.`
            : ''),
        autoClose: 10000
      });
      setTimeout(() => window.location.reload(), 1500);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="md">
      <Note>
        Move your setup to another computer. The export holds your libraries, containers,
        favorites, recent folders, and the ratings, color labels, notes and tags of your files. It
        does not include the asset files or thumbnails; thumbnails rebuild after importing.
      </Note>
      <Category title="Backup and transfer">
        <Property label="Export data" hint="Saves one .gamdata file (Desktop by default).">
          <Button
            className="gam-btn-flat"
            size="xs"
            leftSection={<IconUpload size={14} />}
            loading={busy === 'export'}
            onClick={() => void doExport()}
          >
            Export data
          </Button>
        </Property>
        <Property
          label="Import data"
          hint="Asks where each library folder is on this computer, then merges everything in."
        >
          <Button
            className="gam-btn-flat"
            size="xs"
            leftSection={<IconDownload size={14} />}
            loading={busy === 'import'}
            onClick={() => void doImport()}
          >
            Import data
          </Button>
        </Property>
      </Category>
    </Stack>
  );
}

function LogsSection({ prefs }: { prefs: PreferencesFile }) {
  const current: LogLevel = prefs.logLevel ?? 'info';
  const apply = (next: string) => {
    void savePreferences({ ...prefs, logLevel: next as LogLevel });
  };
  return (
    <Stack gap="md">
      <Note>
        Logs from every subsystem (scanner, database, thumbnail worker, IPC) land in a single
        rotating file. When reporting an issue, click "Open logs folder" and attach the most
        recent <code>main.log</code>.
      </Note>
      <Category title="Logging">
        <Property
          label="Log level"
          hint="Applies immediately to file + console. Default: info."
          wide
        >
          <SegmentedControl
            className="gam-seg"
            fullWidth
            size="xs"
            value={current}
            onChange={apply}
            data={LOG_LEVELS.map((l) => ({ value: l, label: l }))}
          />
        </Property>
        <Property label="Logs folder" hint="Opens the folder with the rotating log files.">
          <Button
            className="gam-btn-flat"
            size="xs"
            leftSection={<IconFolderOpen size={14} />}
            onClick={() => void ipc.openLogsFolder()}
          >
            Open logs folder
          </Button>
        </Property>
      </Category>
    </Stack>
  );
}

function ExternalAppsSection({
  prefs,
  onChanged
}: {
  prefs: PreferencesFile;
  onChanged: () => Promise<void>;
}) {
  const apps = prefs.externalApps || [];
  const [adding, setAdding] = useState(false);
  // Comma-separated extensions - filled by the file-type buttons and/or typed
  // by hand in the advanced field. Starts empty so nothing is registered by
  // accident.
  const [extensionsDraft, setExtensionsDraft] = useState('');
  // "Everything" registers the app with no extension filter (it shows up in
  // Open with… for every file type).
  const [allTypes, setAllTypes] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  const draftExtensions = parseExtensions(extensionsDraft);
  const canChoose = allTypes || draftExtensions.length > 0;

  // A file-type button counts as "on" when every one of its extensions is in
  // the draft.
  const isGroupActive = (group: ExtensionGroup) =>
    !allTypes && group.extensions.every((e) => draftExtensions.includes(e));

  // Toggling adds any missing extensions, or removes all of them if the group
  // was already fully on. Manually typed extensions are preserved.
  const toggleGroup = (group: ExtensionGroup) => {
    const groupExts = group.extensions as readonly string[];
    const next = isGroupActive(group)
      ? draftExtensions.filter((e) => !groupExts.includes(e))
      : [...draftExtensions, ...groupExts.filter((e) => !draftExtensions.includes(e))];
    setAllTypes(false);
    setExtensionsDraft(next.join(','));
  };

  const toggleAllTypes = () => {
    if (allTypes) {
      setAllTypes(false);
    } else {
      setAllTypes(true);
      setExtensionsDraft('');
    }
  };

  const chooseProgram = async () => {
    setAdding(true);
    try {
      const exts = allTypes ? [] : parseExtensions(extensionsDraft);
      // Opens the OS file picker; resolves to null if the user cancels.
      const created = await ipc.addExternalApp(exts);
      if (created) {
        notifications.show({
          color: 'green',
          title: 'External app added',
          message: `${created.name} registered for ${exts.join(', ') || 'every file type'}`
        });
        // Start the next app from a clean slate so it isn't registered for the
        // previous app's file types by accident.
        setExtensionsDraft('');
        setAllTypes(false);
        await onChanged();
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <Stack gap="md">
      <Note>
        Open your files in other programs. Apps you add here appear when you right-click a file
        and choose "Open with…".
      </Note>

      <Category title="Registered apps">
        <Stack gap={6}>
          {apps.length === 0 && (
            <Stack gap={2} align="center" py="md">
              <IconAppWindow size={24} style={{ color: 'var(--gam-dim)' }} />
              <Text size="xs" fw={600} c={T.text}>
                No external apps yet
              </Text>
              <Note>Add one below to open files in Blender, Photoshop, Audacity and more.</Note>
            </Stack>
          )}
          {apps.map((app) => (
            <AppRow key={app.id} app={app} prefs={prefs} onChanged={onChanged} />
          ))}
        </Stack>
      </Category>

      <Category title="Add an external app">
        <Stack gap="md" p="sm">
          {/* Step 1 */}
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <span className="gam-step">1</span>
              <Text size="xs" fw={600} c={T.text}>
                Which files should it open?
              </Text>
            </Group>

            <Group gap={6} wrap="wrap">
              {EXTENSION_GROUPS.map((group) => {
                const active = isGroupActive(group);
                return (
                  <Tooltip
                    key={group.id}
                    label={group.extensions.map((e) => `.${e}`).join('  ')}
                    withinPortal
                  >
                    <Button
                      className="gam-chip"
                      data-on={active || undefined}
                      size="compact-sm"
                      variant="default"
                      leftSection={active ? <IconCheck size={12} /> : undefined}
                      onClick={() => toggleGroup(group)}
                    >
                      {group.label}
                    </Button>
                  </Tooltip>
                );
              })}
              <Tooltip label="Show this app in Open with… for every file type" withinPortal>
                <Button
                  className="gam-chip"
                  data-on={allTypes || undefined}
                  size="compact-sm"
                  variant="default"
                  leftSection={allTypes ? <IconCheck size={12} /> : undefined}
                  onClick={toggleAllTypes}
                >
                  Everything
                </Button>
              </Tooltip>
            </Group>

            <Group gap={6} wrap="wrap" align="center">
              <Text size="xs" c={T.dim}>
                Shows up on:
              </Text>
              {allTypes ? (
                <Badge size="sm">every file type</Badge>
              ) : draftExtensions.length === 0 ? (
                <Text size="xs" c={T.dim} fs="italic">
                  nothing selected yet
                </Text>
              ) : (
                draftExtensions.map((e) => (
                  <Badge key={e} size="sm">
                    .{e}
                  </Badge>
                ))
              )}
            </Group>

            <Button
              className="gam-btn-ghost"
              size="compact-xs"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setShowCustom((v) => !v)}
            >
              {showCustom ? 'Hide custom extensions' : 'Add custom extensions (advanced)'}
            </Button>
            <Collapse in={showCustom}>
              <TextInput
                size="xs"
                label="Custom extensions"
                description="Comma-separated. Added to whatever file types are selected above."
                placeholder="e.g. ini, cfg"
                value={extensionsDraft}
                onChange={(e) => {
                  setAllTypes(false);
                  setExtensionsDraft(e.currentTarget.value);
                }}
              />
            </Collapse>
          </Stack>

          {/* Step 2 */}
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <span className="gam-step">2</span>
              <Text size="xs" fw={600} c={T.text}>
                Choose the program
              </Text>
            </Group>
            <Button
              className="gam-btn-flat"
              size="sm"
              loading={adding}
              disabled={!canChoose}
              onClick={() => void chooseProgram()}
            >
              Browse for application...
            </Button>
          </Stack>
        </Stack>
      </Category>
    </Stack>
  );
}

function AppRow({
  app,
  prefs,
  onChanged
}: {
  app: ExternalAppRegistration;
  prefs: PreferencesFile;
  onChanged: () => Promise<void>;
}) {
  const removeApp = async () => {
    const nextApps = prefs.externalApps.filter((a) => a.id !== app.id);
    await savePreferences({ ...prefs, externalApps: nextApps });
    await onChanged();
  };

  return (
    <div className="gam-row">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" fw={600} c={T.text}>
            {app.name}
          </Text>
          <Text size="xs" c={T.dim} lh={1.4}>
            {app.extensions.length === 0
              ? 'All file types'
              : `.${app.extensions.join(', .')}`}
          </Text>
        </Stack>
        <ActionIcon
          variant="subtle"
          color="red"
          onClick={() => void removeApp()}
          title="Remove app"
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Group>
    </div>
  );
}