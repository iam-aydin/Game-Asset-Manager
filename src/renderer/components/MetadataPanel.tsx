import { useEffect, useMemo, useState } from 'react';
import { Badge, Divider, Group, Stack, Text, Textarea } from '@mantine/core';
import type {
  CollectionRecord,
  CollectionWithCount,
  ColorLabel,
  ExtractedMetadata,
  FileRecord,
  FormatMetadata,
  TagWithCount
} from '@shared/types';
import type { FileOrientation } from '@shared/orientation';
import { formatDimension } from '@shared/units';
import { TagEditor } from './TagEditor';
import { BulkMetadataPanel } from './BulkMetadataPanel';
import { AddToCollectionMenu } from './AddToCollectionMenu';
import { formatBytes, formatDateTime, formatRelativeTime } from '../util/format';
import { usePreferences } from '../util/use-preferences';
import { useSidecarLicense } from '../util/use-sidecar-license';
import { ipc } from '../ipc-client';

interface Props {
  libraryId: string | null;
  /** The most-recently-clicked file. Drives the single-file detail view. */
  primaryFile: FileRecord | null;
  /** All files in the current selection (>= 1 when primaryFile is non-null). */
  selectedFiles: FileRecord[];
  allTags: TagWithCount[];
  collections: CollectionWithCount[];
  activeCollectionId: number | null;
  tagRefreshKey: number;
  onBulkAddTag: (tagName: string) => Promise<void>;
  onBulkRemoveTag: (tagId: number) => Promise<void>;
  onBulkSetOrientation: (orientation: FileOrientation | null) => Promise<void>;
  onBulkSetRating: (rating: number) => Promise<void>;
  onBulkSetColorLabel: (label: ColorLabel | null) => Promise<void>;
  onBulkRerender: () => Promise<void>;
  onBatchRename: () => void;
  onCompare: () => void;
  onAddToCollection: (collectionId: number, fileIds: number[]) => Promise<void> | void;
  onRemoveFromCollection: (collectionId: number, fileIds: number[]) => Promise<void> | void;
  onCreateCollection: (name: string) => Promise<CollectionRecord | null>;
}

/**
 * Right-pane metadata tailored for Game Asset Management.
 */
export function MetadataPanel(props: Props) {
  const {
    libraryId,
    primaryFile,
    selectedFiles,
    allTags,
    collections,
    activeCollectionId,
    tagRefreshKey,
    onAddToCollection,
    onRemoveFromCollection,
    onCreateCollection
  } = props;

  if (!libraryId || selectedFiles.length === 0 || !primaryFile) {
    return (
      <Stack gap="xs" p="md">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          Metadata
        </Text>
        <Text c="dimmed" size="sm">
          Select a file to view details.
        </Text>
      </Stack>
    );
  }

  if (selectedFiles.length > 1) {
    return (
      <BulkMetadataPanel
        libraryId={libraryId}
        selectedFiles={selectedFiles}
        allTags={allTags}
        collections={collections}
        activeCollectionId={activeCollectionId}
        tagRefreshKey={tagRefreshKey}
        onBulkAddTag={props.onBulkAddTag}
        onBulkRemoveTag={props.onBulkRemoveTag}
        onBulkSetOrientation={props.onBulkSetOrientation}
        onBulkSetRating={props.onBulkSetRating}
        onBulkSetColorLabel={props.onBulkSetColorLabel}
        onBulkRerender={props.onBulkRerender}
        onBatchRename={props.onBatchRename}
        onCompare={props.onCompare}
        onAddToCollection={props.onAddToCollection}
        onRemoveFromCollection={props.onRemoveFromCollection}
        onCreateCollection={props.onCreateCollection}
      />
    );
  }

  return (
    <SingleFilePanel
      libraryId={libraryId}
      file={primaryFile}
      allTags={allTags}
      collections={collections}
      activeCollectionId={activeCollectionId}
      tagRefreshKey={tagRefreshKey}
      onAddToCollection={onAddToCollection}
      onRemoveFromCollection={onRemoveFromCollection}
      onCreateCollection={onCreateCollection}
    />
  );
}

function SingleFilePanel({
  libraryId,
  file,
  allTags,
  collections,
  activeCollectionId,
  tagRefreshKey,
  onAddToCollection,
  onRemoveFromCollection,
  onCreateCollection
}: {
  libraryId: string;
  file: FileRecord;
  allTags: TagWithCount[];
  collections: CollectionWithCount[];
  activeCollectionId: number | null;
  tagRefreshKey: number;
  onAddToCollection: (collectionId: number, fileIds: number[]) => Promise<void> | void;
  onRemoveFromCollection: (collectionId: number, fileIds: number[]) => Promise<void> | void;
  onCreateCollection: (name: string) => Promise<CollectionRecord | null>;
}) {
  const metadata = useMemo<ExtractedMetadata | null>(() => {
    if (!file.metadataJson) return null;
    try {
      return JSON.parse(file.metadataJson) as ExtractedMetadata;
    } catch {
      return null;
    }
  }, [file.metadataJson]);

  const sidecarLicense = useSidecarLicense(libraryId, file.parentDir);

  return (
    <Stack gap="sm" p="md" style={{ height: '100%', overflow: 'auto' }}>
      <Group justify="space-between" align="center">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          Metadata
        </Text>
        <Badge variant="light" size="sm">
          .{file.ext}
        </Badge>
      </Group>

      <div>
        <Text size="sm" fw={600} style={{ wordBreak: 'break-all' }}>
          {file.filename}
        </Text>
        <Text size="xs" c="dimmed" mt={2} style={{ wordBreak: 'break-all' }}>
          {file.relPath}
        </Text>
      </div>

      <Divider />

      <Field label="Size" value={formatBytes(file.sizeBytes)} />
      <Field
        label="Modified"
        value={`${formatRelativeTime(file.mtimeMs)} · ${formatDateTime(file.mtimeMs)}`}
      />

      {metadata && (
        <>
          <Divider />
          <ModelStats metadata={metadata} />
        </>
      )}

      {!sidecarLicense.loading && sidecarLicense.text && (
        <>
          <Divider />
          <SidecarLicense text={sidecarLicense.text} />
        </>
      )}

      <Divider />

      <TagEditor
        libraryId={libraryId}
        fileId={file.id}
        allTags={allTags}
        refreshKey={tagRefreshKey}
      />

      <Divider />

      <NotesEditor libraryId={libraryId} file={file} />

      <Divider />

      <Group gap={6} wrap="wrap">
        <AddToCollectionMenu
          collections={collections}
          fileIds={[file.id]}
          onAdd={onAddToCollection}
          onCreate={onCreateCollection}
        />
        {activeCollectionId != null && (
          <button
            type="button"
            onClick={() => void onRemoveFromCollection(activeCollectionId, [file.id])}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 4,
              background: 'var(--mantine-color-red-9)',
              color: 'var(--mantine-color-red-1)',
              fontSize: 12,
              fontWeight: 500
            }}
          >
            Remove from collection
          </button>
        )}
      </Group>
    </Stack>
  );
}

function NotesEditor({ libraryId, file }: { libraryId: string; file: FileRecord }) {
  const [draft, setDraft] = useState(file.notes);

  useEffect(() => {
    setDraft(file.notes);
  }, [file.id, file.notes]);

  useEffect(() => {
    if (draft === file.notes) return;
    const t = setTimeout(() => {
      void ipc.setFileNotes(libraryId, file.id, draft);
    }, 400);
    return () => clearTimeout(t);
  }, [draft, file.id, file.notes, libraryId]);

  return (
    <Stack gap={4}>
      <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
        Notes
      </Text>
      <Textarea
        size="xs"
        autosize
        minRows={2}
        maxRows={8}
        placeholder="Add asset notes, engine specs, LOD hints..."
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
    </Stack>
  );
}

function getTriangleStatusColor(count: number): 'green' | 'yellow' | 'red' {
  if (count <= 15000) return 'green';
  if (count <= 50000) return 'yellow';
  return 'red';
}

function getMeshStatusColor(count: number): 'green' | 'yellow' | 'red' {
  if (count === 1) return 'green';
  if (count <= 4) return 'yellow';
  return 'red';
}

function ModelStats({ metadata }: { metadata: ExtractedMetadata }) {
  const { prefs } = usePreferences();
  const unit = prefs?.unit ?? 'mm';
  const isZero =
    metadata.boundingBox.size[0] === 0 &&
    metadata.boundingBox.size[1] === 0 &&
    metadata.boundingBox.size[2] === 0;
  const sizeStr = isZero
    ? null
    : metadata.boundingBox.size.map((n) => formatDimension(n, unit)).join(' × ');

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          Geometry
        </Text>
      </Group>

      <Field 
        label="Vertices" 
        value={metadata.vertexCount.toLocaleString()} 
        statusColor={getTriangleStatusColor(metadata.vertexCount)} 
      />
      <Field 
        label="Triangles" 
        value={metadata.triangleCount.toLocaleString()} 
        statusColor={getTriangleStatusColor(metadata.triangleCount)} 
      />
      <Field
        label="Meshes"
        value={`${metadata.meshCount} (${metadata.materialCount} material${
          metadata.materialCount === 1 ? '' : 's'
        })`}
        statusColor={getMeshStatusColor(metadata.meshCount)}
      />

      {sizeStr && <Field label="Bounding box" value={sizeStr} />}

      {metadata.textures && metadata.textures.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Textures
          </Text>
          <Stack gap={2} mt={2}>
            {metadata.textures.slice(0, 12).map((t, i) => (
              <Group key={i} gap={6} wrap="nowrap">
                <Badge size="xs" variant="default">
                  {t.role}
                </Badge>
                <Text size="xs" truncate style={{ flex: 1 }}>
                  {t.name}
                </Text>
              </Group>
            ))}
            {metadata.textures.length > 12 && (
              <Text size="xs" c="dimmed">
                +{metadata.textures.length - 12} more
              </Text>
            )}
          </Stack>
        </div>
      )}

      {metadata.materialNames.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Materials
          </Text>
          <Group gap={4} mt={2}>
            {metadata.materialNames.slice(0, 6).map((n) => (
              <Badge key={n} size="xs" variant="default">
                {n}
              </Badge>
            ))}
            {metadata.materialNames.length > 6 && (
              <Text size="xs" c="dimmed">
                +{metadata.materialNames.length - 6}
              </Text>
            )}
          </Group>
        </div>
      )}

      {metadata.format && <SourceMetadata format={metadata.format} />}
    </Stack>
  );
}

function SourceMetadata({ format }: { format: FormatMetadata }) {
  const rows: Array<[string, string]> = [];
  if (format.title) rows.push(['Title', format.title]);
  if (format.author) rows.push(['Author', format.author]);
  if (format.license) rows.push(['License', format.license]);
  if (format.copyright) rows.push(['Copyright', format.copyright]);
  if (format.application) rows.push(['Created with', format.application]);
  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={2}>
        Source
      </Text>
      <Stack gap={2}>
        {rows.map(([label, value]) => (
          <Field key={label} label={label} value={value} />
        ))}
      </Stack>
    </div>
  );
}

function SidecarLicense({ text }: { text: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
        License
      </Text>
      <Textarea
        value={text}
        readOnly
        autosize
        minRows={2}
        maxRows={10}
        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
      />
    </div>
  );
}

function Field({ 
  label, 
  value, 
  statusColor 
}: { 
  label: string; 
  value: string; 
  statusColor?: 'green' | 'yellow' | 'red';
}) {
  const COLOR_MAP = {
    green: '#22c55e',
    yellow: '#eab308',
    red: '#ef4444',
  };

  const topColor = statusColor ? COLOR_MAP[statusColor] : null;

  return (
    <Group justify="space-between" align="flex-end" wrap="nowrap">
      <div>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        <Text size="sm">{value}</Text>
      </div>
      {topColor && (
        <div
          title={`Budget status: ${statusColor}`}
          style={{
            width: 18,
            height: 8,
            borderRadius: 999,
            background: `linear-gradient(to right, ${topColor} 0%, #171717 100%)`,
            marginBottom: 6,
            flexShrink: 0,
          }}
        />
      )}
    </Group>
  );
}