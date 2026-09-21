import { ActionIcon, Badge, Button, Checkbox, Group, Menu, Text, TextInput, Tooltip } from '@mantine/core';
import { IconChevronDown, IconSearch, IconX } from '@tabler/icons-react';
import { SUPPORTED_EXTENSIONS, type SupportedExtension } from '@shared/formats';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  selectedExtensions: Set<SupportedExtension>;
  onToggleExtension: (ext: SupportedExtension) => void;
  onClearExtensions: () => void;
  libraryName: string | null;
  matchBadge?: React.ReactNode;
}

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
  return (
    <>
      {/* Force the filter cluster and every child to be rigid — no flex
       *  grow, no flex shrink, ever. !important beats inline styles. */}
      <style>{`
        .searchbar-filter-cluster,
        .searchbar-filter-cluster * {
          flex: 0 0 0 !important;
          min-width: fit-content !important;
        }
      `}</style>
      <Group
        gap={8}
        wrap="nowrap"
        style={{ flex: '0 0 auto', minWidth: 0, overflow: 'hidden' }}
      >
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
          styles={{
            root: {
              flex: '0 0 0%',
              minWidth: 200,
              maxWidth: 560,
            },
          }}
        />
        <div
          className="searchbar-filter-cluster"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
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
                maxWidth: 180,
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
          <Menu closeOnItemClick={false} withinPortal shadow="md" width={170} position="bottom-end">
            <Menu.Target>
              <Button
                size="xs"
                variant={activeCount > 0 ? 'filled' : 'default'}
                color={activeCount > 0 ? 'indigo' : undefined}
                rightSection={<IconChevronDown size={12} />}
                style={{ whiteSpace: 'nowrap' }}
              >
                Filter{activeCount > 0 ? ` (${activeCount})` : ''}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {SUPPORTED_EXTENSIONS.map((ext) => (
                <Menu.Item
                  key={ext}
                  onClick={() => onToggleExtension(ext)}
                  leftSection={
                    <Checkbox
                      checked={selectedExtensions.has(ext)}
                      onChange={() => onToggleExtension(ext)}
                      size="xs"
                      tabIndex={-1}
                      style={{ pointerEvents: 'none' }}
                    />
                  }
                >
                  .{ext}
                </Menu.Item>
              ))}
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
          {matchBadge && <div>{matchBadge}</div>}
        </div>
      </Group>
    </>
  );
}