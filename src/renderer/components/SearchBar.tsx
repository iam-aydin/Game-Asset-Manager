import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Menu,
  Text,
  TextInput,
  Tooltip,
  useComputedColorScheme
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconSearch, IconX } from '@tabler/icons-react';
import {
  MODEL_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  TEXT_EXTENSIONS,
  type SupportedExtension
} from '@shared/formats';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  selectedExtensions: Set<SupportedExtension>;
  onToggleExtension: (ext: SupportedExtension) => void;
  /** Select (selected = true) or deselect (selected = false) many extensions
   *  in one state update. Used by the per-category checkbox. */
  onSetExtensions: (exts: SupportedExtension[], selected: boolean) => void;
  onClearExtensions: () => void;
  /** Active library — drives the inline scope hint so the user can see at
   *  a glance that the search is library-scoped. */
  libraryName: string | null;
  /** Optional match-count badge, rendered right after the Filter button in
   *  this component's own tight-gap Group. Owned by the caller since
   *  "filter active" spans more than just the extension filter (tags,
   *  rating, color labels, duplicates-only). */
  matchBadge?: React.ReactNode;
}

/**
 * Puts the given extensions first (in the order listed), keeps everything
 * else in its original relative order after them. Used so the 3D category
 * leads with the formats used most, rather than MODEL_EXTENSIONS' source
 * order — new formats added to MODEL_EXTENSIONS later still show up
 * automatically, just after whatever's pinned here.
 */
function withPriority(
  list: readonly SupportedExtension[],
  priority: SupportedExtension[]
): SupportedExtension[] {
  const prioritySet = new Set(priority);
  return [
    ...priority.filter((p) => list.includes(p)),
    ...list.filter((e) => !prioritySet.has(e))
  ];
}

const MODEL_DISPLAY_ORDER = withPriority(MODEL_EXTENSIONS, ['gltf', 'fbx']);

/**
 * Filter categories, collapsed by default. Adding a new format group later
 * is just one more entry here once its extensions array exists in
 * @shared/formats — the collapse/divider/checkbox UI below is fully generic
 * over this list, no other changes needed.
 */
const EXTENSION_CATEGORIES: { label: string; extensions: readonly SupportedExtension[] }[] = [
  { label: '3D', extensions: MODEL_DISPLAY_ORDER },
  { label: 'Images', extensions: IMAGE_EXTENSIONS },
  { label: 'Audio', extensions: AUDIO_EXTENSIONS },
  { label: 'Video', extensions: VIDEO_EXTENSIONS },
  { label: 'Text', extensions: TEXT_EXTENSIONS }
];

/* Glass styling for the Filter dropdown. Dark by default; the `.is-light`
   class (set from the app's real color scheme in JS) switches to the light
   variant. The Filter BUTTON itself is no longer custom-styled: it is a
   plain Mantine light/indigo button so it matches the "N matches" badge. */
const FILTER_CSS = `
/* ---------- Responsive layout ---------- */
.gam-search-root {
  container-type: inline-size;
  container-name: gam-search;
}
/* Hide the "in <library>" badge when the bar gets narrow. */
@container gam-search (max-width: 520px) {
  .gam-scope-badge { display: none !important; }
}
.gam-match-wrap { flex-shrink: 0; white-space: nowrap; }
.gam-match-wrap * { white-space: nowrap; }

/* ---------- Filter dropdown: crystal clear, light blur, blue -> red tint ---------- */
.gam-filter-dropdown {
  --gf-text: #ececee;
  --gf-hover: rgba(255, 255, 255, 0.1);
  --gf-divider: rgba(255, 255, 255, 0.16);
  --gf-accent: var(--wh3d-waveform-played, #4c6ef5);
  background: linear-gradient(135deg, rgba(59, 91, 219, 0.1), rgba(255, 0, 0, 0.1)) !important;
  -webkit-backdrop-filter: blur(14px) saturate(130%);
  backdrop-filter: blur(14px) saturate(130%);
  border: 1px solid rgba(255, 255, 255, 0.22) !important;
  border-radius: 20px !important;
  box-shadow:
    0 12px 36px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.25) !important;
  color: var(--gf-text);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}
/* Light theme: same look plus a white tint so the dark text stays readable
   over dark content. */
.gam-filter-dropdown.is-light {
  --gf-text: #16171a;
  --gf-hover: rgba(0, 0, 0, 0.06);
  --gf-divider: rgba(0, 0, 0, 0.12);
  background:
    linear-gradient(135deg, rgba(59, 91, 219, 0.1), rgba(255, 0, 0, 0.1)),
    rgba(255, 255, 255, 0.62) !important;
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.85) !important;
  box-shadow:
    0 0 0 1px rgba(30, 40, 70, 0.1),
    0 12px 36px rgba(30, 40, 70, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
  text-shadow: none;
}
.gam-filter-dropdown .mantine-Text-root { color: var(--gf-text); }

/* ---------- Rows ---------- */
.gam-filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 12px;
  transition: background 120ms ease;
}
.gam-filter-row:hover { background: var(--gf-hover); }
.gam-filter-head { cursor: pointer; }
.gam-filter-ext {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  margin: 1px 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms ease;
}
.gam-filter-ext:hover { background: var(--gf-hover); }

/* Hand cursor on every checkbox part */
.gam-filter-dropdown .mantine-Checkbox-root,
.gam-filter-dropdown .mantine-Checkbox-body,
.gam-filter-dropdown .mantine-Checkbox-inner,
.gam-filter-dropdown .mantine-Checkbox-input,
.gam-filter-dropdown .mantine-Checkbox-label {
  cursor: pointer !important;
}
/* Unchecked boxes: fully transparent fill, border only */
.gam-filter-dropdown .mantine-Checkbox-input {
  background: transparent !important;
  border: 1px solid color-mix(in srgb, var(--gf-text) 65%, transparent);
  border-radius: 6px;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.gam-filter-dropdown .mantine-Checkbox-input:hover { transform: scale(1.1); }
.gam-filter-dropdown .mantine-Checkbox-input:checked,
.gam-filter-dropdown .mantine-Checkbox-input:indeterminate {
  background: var(--gf-accent) !important;
  border-color: var(--gf-accent);
}

.gam-filter-divider { border-color: var(--gf-divider) !important; }
.gam-filter-clear {
  border-radius: 12px !important;
  margin: 0 8px 6px;
  width: calc(100% - 16px) !important;
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .gam-filter-row, .gam-filter-ext { transition: none !important; }
}
`;

/* Glass styling for every OTHER dropdown in the app (theme menu, Workspace
   list, any Menu / Select). Buttons are not touched. The Filter dropdown has
   its own rules above and is excluded here. */
function buildDropdownCss(isLight: boolean): string {
  const hover = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)';
  const bg = isLight
    ? 'linear-gradient(135deg, rgba(59, 91, 219, 0.1), rgba(255, 0, 0, 0.1)), rgba(255, 255, 255, 0.62)'
    : 'linear-gradient(135deg, rgba(59, 91, 219, 0.1), rgba(255, 0, 0, 0.1))';
  const border = isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.22)';
  const shadow = isLight
    ? '0 0 0 1px rgba(30, 40, 70, 0.1), 0 12px 36px rgba(30, 40, 70, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9)'
    : '0 12px 36px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.25)';
  const text = isLight ? '#16171a' : '#ececee';

  return `
.mantine-Menu-dropdown:not(.gam-filter-dropdown),
.mantine-Select-dropdown,
.mantine-Combobox-dropdown {
  background: ${bg} !important;
  -webkit-backdrop-filter: blur(14px) saturate(130%);
  backdrop-filter: blur(14px) saturate(130%);
  border: 1px solid ${border} !important;
  border-radius: 16px !important;
  box-shadow: ${shadow} !important;
  padding: 6px !important;
  color: ${text};
  ${isLight ? '' : 'text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);'}
  animation: gam-dd-pop 160ms ease;
}
.mantine-Menu-dropdown:not(.gam-filter-dropdown) .mantine-Menu-item,
.mantine-Select-option,
.mantine-Combobox-option {
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms ease;
}
.mantine-Menu-dropdown:not(.gam-filter-dropdown) .mantine-Menu-item:hover,
.mantine-Menu-dropdown:not(.gam-filter-dropdown) .mantine-Menu-item[data-hovered],
.mantine-Select-option:hover,
.mantine-Combobox-option:hover,
.mantine-Combobox-option[data-combobox-active] {
  background: ${hover} !important;
}
@keyframes gam-dd-pop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .mantine-Menu-dropdown, .mantine-Select-dropdown, .mantine-Combobox-dropdown { animation: none !important; }
}
`;
}

export function SearchBar({
  query,
  onQueryChange,
  selectedExtensions,
  onToggleExtension,
  onSetExtensions,
  onClearExtensions,
  libraryName,
  matchBadge
}: Props) {
  const activeCount = selectedExtensions.size;
  const scopeLabel = libraryName ?? 'no library';
  const isLight = useComputedColorScheme('dark') === 'light';
  const lightClass = isLight ? ' is-light' : '';
  // Collapsed by default, per request — user clicks a category to reveal
  // its extensions rather than seeing every format at once.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleCategory = (label: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    // flex-grow 100 so this group takes nearly all free space in the header
    // row (the caller's spacer div is flex: 1 and would otherwise split it
    // 50/50 and squeeze the search bar on narrow windows). overflow: clip +
    // clip margin leaves room for the Filter button's hover lift and glow.
    <Group
      className="gam-search-root"
      gap={8}
      wrap="nowrap"
      style={{ flex: '100 1 0%', minWidth: 0, overflow: 'clip', overflowClipMargin: 24 }}
    >
      <style>{FILTER_CSS}</style>
      <style>{buildDropdownCss(isLight)}</style>
      <TextInput
        size="xs"
        placeholder={
          libraryName ? `Search in ${libraryName}…` : 'Search filenames, tags, materials…'
        }
        value={query}
        onChange={(e) => onQueryChange(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
        rightSection={
          query ? (
            <ActionIcon variant="subtle" size="sm" onClick={() => onQueryChange('')}>
              <IconX size={12} />
            </ActionIcon>
          ) : null
        }
        style={{ flex: '1 1 160px', minWidth: 96, maxWidth: 480 }}
      />
      <Tooltip
        label={`Search is scoped to ${scopeLabel}. Switch libraries from the left sidebar.`}
        withinPortal
      >
        <Badge
          className="gam-scope-badge"
          size="sm"
          variant="light"
          color="gray"
          style={{
            textTransform: 'none',
            cursor: 'help',
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: 200
          }}
        >
          <Text component="span" size="xs" c="dimmed">
            in&nbsp;
          </Text>
          <Text component="span" size="xs" fw={600} truncate>
            {scopeLabel}
          </Text>
        </Badge>
      </Tooltip>
      <Menu
        closeOnItemClick={false}
        withinPortal
        width={220}
        position="bottom-end"
        offset={8}
        transitionProps={{ transition: 'pop-top-right', duration: 180, timingFunction: 'ease' }}
        classNames={{ dropdown: `gam-filter-dropdown${lightClass}` }}
      >
        <Menu.Target>
          {/* Same variant + colour as the "N matches" badge (light / indigo),
              so the two read as one matching pair. */}
          <Button
            size="xs"
            variant="light"
            color="indigo"
            radius="xl"
            rightSection={<IconChevronDown size={12} />}
            style={{ flexShrink: 0 }}
          >
            Filter{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <div style={{ padding: '8px 10px' }}>
            {EXTENSION_CATEGORIES.map((category, i) => {
              const isOpen = expanded.has(category.label);
              const selectedInCategory = category.extensions.filter((e) =>
                selectedExtensions.has(e)
              ).length;
              const allSelected =
                category.extensions.length > 0 &&
                selectedInCategory === category.extensions.length;
              const someSelected = selectedInCategory > 0 && !allSelected;
              return (
                <div key={category.label}>
                  {i > 0 && <Divider my={4} className="gam-filter-divider" />}
                  {/* Row = expand/collapse button + category checkbox as
                      siblings (an input can't live inside a <button>). */}
                  <div className="gam-filter-row">
                    <button
                      type="button"
                      className="gam-filter-head"
                      onClick={() => toggleCategory(category.label)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flex: 1,
                        minWidth: 0,
                        boxSizing: 'border-box',
                        padding: '7px 8px'
                      }}
                    >
                      <IconChevronRight
                        size={12}
                        style={{
                          transform: isOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 160ms ease',
                          flexShrink: 0,
                          color: 'var(--mantine-color-dimmed)'
                        }}
                      />
                      <Text size="xs" fw={600} style={{ flex: 1 }}>
                        {category.label}
                      </Text>
                      {selectedInCategory > 0 && (
                        <Badge size="xs" variant="light" color="indigo">
                          {selectedInCategory}
                        </Badge>
                      )}
                    </button>
                    <Tooltip
                      label={
                        allSelected
                          ? `Clear all ${category.label}`
                          : `Show only ${category.label} (select all)`
                      }
                      withinPortal
                      openDelay={400}
                    >
                      <Checkbox
                        size="xs"
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={() =>
                          onSetExtensions([...category.extensions], !allSelected)
                        }
                        aria-label={`Select all ${category.label}`}
                        style={{ flexShrink: 0, paddingRight: 8 }}
                      />
                    </Tooltip>
                  </div>
                  <Collapse in={isOpen} transitionDuration={180}>
                    <div style={{ paddingLeft: 18, paddingBottom: 4 }}>
                      {category.extensions.map((ext) => (
                        <label key={ext} className="gam-filter-ext">
                          <Checkbox
                            size="xs"
                            checked={selectedExtensions.has(ext)}
                            onChange={() => onToggleExtension(ext)}
                          />
                          <Text size="xs" style={{ cursor: 'pointer' }}>
                            .{ext}
                          </Text>
                        </label>
                      ))}
                    </div>
                  </Collapse>
                </div>
              );
            })}
          </div>
          {activeCount > 0 && (
            <>
              <Divider className="gam-filter-divider" />
              <div style={{ paddingTop: 6 }}>
                <Menu.Item color="red" className="gam-filter-clear" onClick={onClearExtensions}>
                  Clear filter
                </Menu.Item>
              </div>
            </>
          )}
        </Menu.Dropdown>
      </Menu>
      {matchBadge && <div className="gam-match-wrap">{matchBadge}</div>}
    </Group>
  );
}