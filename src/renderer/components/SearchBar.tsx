import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Menu,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconSearch, IconX } from '@tabler/icons-react';
import { MODEL_EXTENSIONS, IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, TEXT_EXTENSIONS, type SupportedExtension } from '@shared/formats';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  selectedExtensions: Set<SupportedExtension>;
  onToggleExtension: (ext: SupportedExtension) => void;
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
 * (Audio, Text, ...) is just one more entry here once its extensions array
 * exists in @shared/formats — the collapse/divider/checkbox UI below is
 * fully generic over this list, no other changes needed.
 */
const EXTENSION_CATEGORIES: { label: string; extensions: readonly SupportedExtension[] }[] = [
  { label: '3D', extensions: MODEL_DISPLAY_ORDER },
  { label: 'Images', extensions: IMAGE_EXTENSIONS },
  { label: 'Audio', extensions: AUDIO_EXTENSIONS },
  { label: 'Text', extensions: TEXT_EXTENSIONS }
];

export function SearchBar({
  query,
  onQueryChange,
  selectedExtensions,
  onToggleExtension,
  onClearExtensions,
  libraryName,
  matchBadge
}: Props) {
  const activeCount = selectedExtensions.size;
  const scopeLabel = libraryName ?? 'no library';
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
    <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
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
        style={{ flex: 1, minWidth: 64, maxWidth: 480 }}
      />
      <Tooltip
        label={`Search is scoped to ${scopeLabel}. Switch libraries from the left sidebar.`}
        withinPortal
      >
        <Badge
          size="sm"
          variant="light"
          color="gray"
          style={{
            textTransform: 'none',
            cursor: 'help',
            flexShrink: 0,
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
      <Menu closeOnItemClick={false} withinPortal shadow="md" width={200} position="bottom-end">
        <Menu.Target>
          <Button
            size="xs"
            variant={activeCount > 0 ? 'filled' : 'default'}
            color={activeCount > 0 ? 'indigo' : undefined}
            rightSection={<IconChevronDown size={12} />}
            style={{ flexShrink: 0 }}
          >
            Filter{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <div style={{ padding: '4px 8px' }}>
            {EXTENSION_CATEGORIES.map((category, i) => {
              const isOpen = expanded.has(category.label);
              const selectedInCategory = category.extensions.filter((e) =>
                selectedExtensions.has(e)
              ).length;
              return (
                <div key={category.label}>
                  {i > 0 && <Divider my={4} />}
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.label)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 4px',
                      borderRadius: 4
                    }}
                  >
                    <IconChevronRight
                      size={12}
                      style={{
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                        transition: 'transform 100ms ease',
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
                  {isOpen && (
                    <div style={{ paddingLeft: 18 }}>
                      {category.extensions.map((ext) => (
                        <label
                          key={ext}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 4px',
                            cursor: 'pointer',
                            borderRadius: 4
                          }}
                        >
                          <Checkbox
                            size="xs"
                            checked={selectedExtensions.has(ext)}
                            onChange={() => onToggleExtension(ext)}
                          />
                          <Text size="xs">.{ext}</Text>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {activeCount > 0 && (
            <>
              <Menu.Divider />
              <Menu.Item color="red" onClick={onClearExtensions}>
                Clear filter
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>
      {matchBadge && <div style={{ flexShrink: 0 }}>{matchBadge}</div>}
    </Group>
  );
}