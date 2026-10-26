import { ActionIcon, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconFolder, IconStar, IconStarOff } from '@tabler/icons-react';

interface Props {
  /** Entries as "libraryId|folderPath" keys (folderPath is "" for a library root). */
  paths: string[];
  /** libraryId -> display name. */
  libraryNames: Record<string, string>;
  /** Key of the currently open folder, used to highlight the active row. */
  selectedKey: string;
  onOpen: (key: string) => void;
  onToggleFavorite: (key: string) => void;
  isFavorite: (key: string) => boolean;
}

function splitKey(key: string): { libraryId: string; path: string } {
  const i = key.indexOf('|');
  return i < 0 ? { libraryId: '', path: key } : { libraryId: key.slice(0, i), path: key.slice(i + 1) };
}

/**
 * Headerless list of folder rows used in the pinned-bottom Favorites/Recent
 * sections. Entries are global: they can point into any library.
 */
export function FolderRowList({
  paths,
  libraryNames,
  selectedKey,
  onOpen,
  onToggleFavorite,
  isFavorite
}: Props) {
  if (paths.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        Empty.
      </Text>
    );
  }
  return (
    <Stack gap={2}>
      {paths.map((k) => (
        <Row
          key={k}
          entryKey={k}
          libraryName={libraryNames[splitKey(k).libraryId] ?? '(removed library)'}
          active={k === selectedKey}
          isFavorite={isFavorite(k)}
          onOpen={() => onOpen(k)}
          onToggleFavorite={() => onToggleFavorite(k)}
        />
      ))}
    </Stack>
  );
}

function Row({
  entryKey,
  libraryName,
  active,
  isFavorite,
  onOpen,
  onToggleFavorite
}: {
  entryKey: string;
  libraryName: string;
  active: boolean;
  isFavorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const { path } = splitKey(entryKey);
  const display = path === '' ? libraryName : path.split('/').slice(-1)[0];
  return (
    <Group
      gap={2}
      wrap="nowrap"
      style={{
        borderRadius: 4,
        background: active ? 'var(--mantine-color-dark-5)' : undefined
      }}
    >
      <UnstyledButton
        onClick={onOpen}
        title={path === '' ? libraryName : `${libraryName}/${path}`}
        style={{ flex: 1, padding: '3px 6px', minWidth: 0 }}
      >
        <Group gap={6} wrap="nowrap">
          <IconFolder size={12} />
          <Text size="sm" truncate style={{ flex: 1 }}>
            {display}
          </Text>
          {path !== '' && (
            <Text size="xs" c="dimmed" truncate style={{ maxWidth: 80 }}>
              {libraryName}
            </Text>
          )}
        </Group>
      </UnstyledButton>
      <Tooltip label={isFavorite ? 'Unpin from favorites' : 'Pin to favorites'}>
        <ActionIcon
          variant="subtle"
          color={isFavorite ? 'yellow' : 'gray'}
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={isFavorite ? 'Unpin' : 'Pin'}
        >
          {isFavorite ? <IconStar size={11} /> : <IconStarOff size={11} />}
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}