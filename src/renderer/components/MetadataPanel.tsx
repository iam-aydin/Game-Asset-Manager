import { useEffect, useMemo, useState } from 'react';
import { Badge, Divider, Group, Stack, Text, Textarea, useComputedColorScheme } from '@mantine/core';
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
import { isAudioExtension, isImageExtension } from '@shared/formats';
import { TagEditor } from './TagEditor';
import { BulkMetadataPanel } from './BulkMetadataPanel';
import { AddToCollectionMenu } from './AddToCollectionMenu';
import { formatBytes, formatDateTime, formatRelativeTime } from '../util/format';
import { usePreferences } from '../util/use-preferences';
import { useSidecarLicense } from '../util/use-sidecar-license';
import { ipc } from '../ipc-client';

// Local on purpose: works even if @shared/formats has no video helper yet.
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'bik', 'm4v', 'ogv'];
const isVideoExtension = (ext: string): boolean =>
  VIDEO_EXTENSIONS.includes(ext.replace(/^\./, '').toLowerCase());

interface Props {
  libraryId: string | null;
  primaryFile: FileRecord | null;
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

  const isImage = isImageExtension(file.ext);
  const isAudio = isAudioExtension(file.ext);
  const isVideo = isVideoExtension(file.ext);

  // Explicitly check for 3D model status
  const isModel =
    metadata?.thumbSource === 'model' ||
    (metadata &&
      metadata.thumbSource !== 'document' &&
      !isImage &&
      !isAudio &&
      !isVideo &&
      (metadata.vertexCount > 0 || metadata.meshCount > 0));

  // Width falls back to imageWidth (it used to fall back to imageHeight,
  // which made images without the detailed `image` block show height x height).
  const width = metadata?.image?.width ?? metadata?.imageWidth;
  const height = metadata?.image?.height ?? metadata?.imageHeight;

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

      {/* Audio Stats */}
      {isAudio && (
        <>
          <Divider />
          <AudioStats file={file} metadata={metadata} />
        </>
      )}

      {/* Video Stats */}
      {isVideo && (
        <>
          <Divider />
          <VideoStats libraryId={libraryId} file={file} metadata={metadata} />
        </>
      )}

      {/* 3D Model Stats — Only renders for actual 3D model files */}
      {isModel && metadata && (
        <>
          <Divider />
          <ModelStats metadata={metadata} />
        </>
      )}

      {/* Image Stats */}
      {isImage && metadata && (
        <>
          <Divider />
          <ImageStats metadata={metadata} width={width} height={height} />
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

// ---- Shared helpers ---------------------------------------------------------

const COMMON_ASPECTS: Array<[number, number]> = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [21, 9],
  [2, 1]
];

/**
 * Aspect ratio label. Snaps to a common ratio (16:9, 4:3, ...) when within 1%,
 * so 1920 x 1081 reads 16:9 instead of 1920:1081. Portrait ratios are covered
 * by checking each pair both ways.
 */
function formatAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  for (const [w, h] of COMMON_ASPECTS) {
    for (const [a, b] of [
      [w, h],
      [h, w]
    ]) {
      const target = a / b;
      if (Math.abs(ratio - target) / target <= 0.01) return `${a}:${b}`;
    }
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  const w = width / d;
  const h = height / d;
  return w > 50 || h > 50 ? `${ratio.toFixed(2)}:1` : `${w}:${h}`;
}

function getBitrateStatusColor(kbps: number): 'green' | 'yellow' | 'red' {
  if (kbps <= 128) return 'red';
  if (kbps < 256) return 'yellow';
  return 'green';
}

function getSampleRateStatusColor(hz: number): 'green' | 'yellow' | 'red' {
  if (hz < 44100) return 'red';
  return 'green';
}

function formatAudioChannels(channels?: number): string | null {
  if (channels === undefined || channels === null) return null;
  if (channels === 1) return '1 (Mono)';
  if (channels === 2) return '2 (Stereo)';
  if (channels === 6) return '6 (5.1 Surround)';
  return `${channels} channels`;
}

function formatAudioDuration(durationSec?: number): string | null {
  if (durationSec === undefined || durationSec === null || isNaN(durationSec)) return null;
  const mins = Math.floor(durationSec / 60);
  const secs = Math.floor(durationSec % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function AudioStats({ file, metadata }: { file: FileRecord; metadata: ExtractedMetadata | null }) {
  const m = (metadata || {}) as Record<string, any>;
  const audio = m.audio || m;

  const duration: number | null =
    audio.duration ??
    audio.length ??
    audio.durationSeconds ??
    audio.durationSec ??
    m.duration ??
    m.length ??
    null;

  const channels: number | null =
    audio.channels ??
    audio.numberOfChannels ??
    audio.channelCount ??
    m.channels ??
    null;

  const sampleRateRaw: number | null =
    audio.sampleRate ??
    audio.sample_rate ??
    audio.samplingRate ??
    m.sampleRate ??
    null;

  let bitrateRaw: number | null =
    audio.bitrate ??
    audio.bitRate ??
    m.bitrate ??
    m.bitRate ??
    m.format?.bitrate ??
    m.format?.bit_rate ??
    null;

  const sampleRateHz = sampleRateRaw
    ? sampleRateRaw < 1000
      ? sampleRateRaw * 1000
      : sampleRateRaw
    : null;

  let bitrateKbps: number | null = null;

  if (bitrateRaw) {
    bitrateKbps = bitrateRaw > 1000 ? Math.round(bitrateRaw / 1000) : Math.round(bitrateRaw);
  } else if (duration && duration > 0 && file.sizeBytes > 0) {
    bitrateKbps = Math.round((file.sizeBytes * 8) / (duration * 1000));
  }

  const durationStr = formatAudioDuration(duration ?? undefined);
  const channelsStr = formatAudioChannels(channels ?? undefined);

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          Audio
        </Text>
      </Group>

      {durationStr && <Field label="Length" value={durationStr} />}
      {channelsStr && <Field label="Channels" value={channelsStr} />}

      {bitrateKbps !== null && bitrateKbps > 0 && (
        <Field
          label="Bitrate"
          value={`${bitrateKbps} kbps`}
          statusColor={getBitrateStatusColor(bitrateKbps)}
        />
      )}

      {sampleRateHz !== null && (
        <Field
          label="Sample rate"
          value={`${(sampleRateHz / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kHz`}
          statusColor={getSampleRateStatusColor(sampleRateHz)}
        />
      )}

      {metadata?.format && <SourceMetadata format={metadata.format} />}
    </Stack>
  );
}

// ---- Video ------------------------------------------------------------------

function formatVideoDuration(durationSec?: number | null): string | null {
  if (durationSec === undefined || durationSec === null || !Number.isFinite(durationSec)) return null;
  if (durationSec <= 0) return null;
  const hrs = Math.floor(durationSec / 3600);
  const mins = Math.floor((durationSec % 3600) / 60);
  const secs = Math.floor(durationSec % 60);
  const ss = secs.toString().padStart(2, '0');
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${ss}`;
  return `${mins}:${ss}`;
}

/** Reads length + resolution straight from the file, so it works even when the
 *  indexer didn't extract any video metadata. */
function useVideoProbe(libraryId: string, fileId: number) {
  const [info, setInfo] = useState<{ duration: number; width: number; height: number } | null>(
    null
  );

  useEffect(() => {
    setInfo(null);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      setInfo({
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth,
        height: v.videoHeight
      });
    };
    v.onerror = () => setInfo(null);
    v.src = `wh3d-file://${encodeURIComponent(libraryId)}/${fileId}`;
    return () => {
      v.onloadedmetadata = null;
      v.onerror = null;
      v.removeAttribute('src');
      v.load();
    };
  }, [libraryId, fileId]);

  return info;
}

function getVideoResolutionLabel(width: number, height: number): string | null {
  const longSide = Math.max(width, height);
  if (longSide >= 3840) return '4K';
  if (longSide >= 2560) return '1440p';
  if (longSide >= 1900) return '1080p';
  if (longSide >= 1260) return '720p';
  if (longSide >= 850) return '480p';
  return null;
}

// ---- Video ratings ----------------------------------------------------------
// Tune everything here. Long side is used so vertical and scope-ratio videos rate fairly.

/** >= 1080p green, 480p up to (not incl.) 1080p yellow, below 480p red. */
function getVideoResolutionStatus(width: number, height: number): 'green' | 'yellow' | 'red' {
  const longSide = Math.max(width, height);
  if (longSide >= 1900) return 'green';
  if (longSide >= 850) return 'yellow';
  return 'red';
}

/** 60 fps green, 30 fps yellow, anything lower red (59/29 allow for 59.94 / 29.97). */
function getFpsStatus(fps: number): 'green' | 'yellow' | 'red' {
  if (fps >= 59) return 'green';
  if (fps >= 29) return 'yellow';
  return 'red';
}

// Reference video bitrates (kbps) from YouTube's recommended H.264 SDR upload table:
// [pixels, standard frame rate (<=30), high frame rate (>=48)]
const BITRATE_TIERS: Array<[number, number, number]> = [
  [640 * 360, 1000, 1500],
  [854 * 480, 2500, 4000],
  [1280 * 720, 5000, 7500],
  [1920 * 1080, 8000, 12000],
  [2560 * 1440, 16000, 24000],
  [3840 * 2160, 40000, 60000]
];

/** Newer codecs reach the same quality with fewer bits than H.264. */
function codecBitrateFactor(codec: string | null): number {
  const c = (codec ?? '').toLowerCase();
  if (c.includes('av1') || c.includes('av01')) return 0.5;
  if (c.includes('vp9') || c.includes('vp09')) return 0.6;
  if (c.includes('hevc') || c.includes('h265') || c.includes('hvc1') || c.includes('hev1'))
    return 0.6;
  return 1;
}

function referenceBitrateKbps(width: number, height: number, fps: number | null): number {
  const px = width * height;
  const col = fps && fps >= 48 ? 2 : 1;
  const first = BITRATE_TIERS[0];
  const last = BITRATE_TIERS[BITRATE_TIERS.length - 1];
  if (px <= first[0]) return (first[col] * px) / first[0];
  if (px >= last[0]) return (last[col] * px) / last[0];
  for (let i = 0; i < BITRATE_TIERS.length - 1; i++) {
    const lo = BITRATE_TIERS[i];
    const hi = BITRATE_TIERS[i + 1];
    if (px >= lo[0] && px <= hi[0]) {
      const t = (px - lo[0]) / (hi[0] - lo[0]);
      return lo[col] + t * (hi[col] - lo[col]);
    }
  }
  return last[col];
}

/** Rated against what that resolution/fps/codec normally needs: >= 60% green, >= 30% yellow. */
function getVideoBitrateStatus(
  kbps: number,
  width: number,
  height: number,
  fps: number | null,
  codec: string | null
): 'green' | 'yellow' | 'red' {
  const expected = referenceBitrateKbps(width, height, fps) * codecBitrateFactor(codec);
  const ratio = kbps / expected;
  if (ratio >= 0.6) return 'green';
  if (ratio >= 0.3) return 'yellow';
  return 'red';
}

function VideoStats({
  libraryId,
  file,
  metadata
}: {
  libraryId: string;
  file: FileRecord;
  metadata: ExtractedMetadata | null;
}) {
  const probe = useVideoProbe(libraryId, file.id);
  const m = (metadata || {}) as Record<string, any>;
  const video = m.video || m;
  const audio = m.audio || m.audioStream || m.audioTrack || {};

  const duration: number | null =
    video.duration ??
    video.durationSeconds ??
    video.durationSec ??
    m.duration ??
    (probe && probe.duration > 0 ? probe.duration : null);

  const width: number | null =
    video.width ?? m.videoWidth ?? (probe && probe.width > 0 ? probe.width : null);
  const height: number | null =
    video.height ?? m.videoHeight ?? (probe && probe.height > 0 ? probe.height : null);

  const fps: number | null = video.fps ?? video.frameRate ?? m.fps ?? m.frameRate ?? null;
  const codec: string | null = video.codec ?? video.videoCodec ?? m.codec ?? m.videoCodec ?? null;

  // The indexer stores the overall bitrate as `bitrateKbps` (already in kbps).
  const bitrateRaw: number | null =
    video.bitrateKbps ?? video.bitrate ?? video.bitRate ?? m.bitrateKbps ?? m.bitrate ?? m.bitRate ?? null;
  let bitrateKbps: number | null = null;
  if (bitrateRaw) {
    bitrateKbps =
      video.bitrateKbps != null || m.bitrateKbps != null
        ? Math.round(bitrateRaw)
        : bitrateRaw > 100000
          ? Math.round(bitrateRaw / 1000)
          : Math.round(bitrateRaw);
  } else if (duration && duration > 0 && file.sizeBytes > 0) {
    bitrateKbps = Math.round((file.sizeBytes * 8) / (duration * 1000));
  }

  const aspect: string | null = width && height ? formatAspectRatio(width, height) : null;

  // Audio track (same ratings as the audio files use)
  const audioCodec: string | null =
    audio.codec ?? audio.audioCodec ?? video.audioCodec ?? m.audioCodec ?? null;
  const audioChannels: number | null =
    audio.channels ?? audio.numberOfChannels ?? audio.channelCount ?? video.audioChannels ?? m.audioChannels ?? null;
  const audioRateRaw: number | null =
    audio.sampleRate ?? audio.sample_rate ?? audio.samplingRate ?? video.audioSampleRate ?? m.audioSampleRate ?? null;
  const audioRateHz = audioRateRaw ? (audioRateRaw < 1000 ? audioRateRaw * 1000 : audioRateRaw) : null;
  // The indexer stores `audioBitrateKbps` (already kbps); other keys are raw/unknown units.
  const audioBitrateDirect: number | null = video.audioBitrateKbps ?? m.audioBitrateKbps ?? null;
  const audioBitrateRaw: number | null =
    audioBitrateDirect ?? audio.bitrate ?? audio.bitRate ?? m.audioBitrate ?? m.audioBitRate ?? null;
  const audioBitrateKbps = audioBitrateRaw
    ? audioBitrateDirect != null
      ? Math.round(audioBitrateRaw)
      : audioBitrateRaw > 1000
      ? Math.round(audioBitrateRaw / 1000)
      : Math.round(audioBitrateRaw)
    : null;
  const channelsStr = formatAudioChannels(audioChannels ?? undefined);
  const hasAudioInfo = !!(audioCodec || channelsStr || audioRateHz || audioBitrateKbps);

  const durationStr = formatVideoDuration(duration);
  const resLabel = width && height ? getVideoResolutionLabel(width, height) : null;

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          Video
        </Text>
      </Group>

      {durationStr && <Field label="Length" value={durationStr} />}
      {width && height && (
        <Field
          label="Resolution"
          value={`${width} × ${height} px${resLabel ? ` (${resLabel})` : ''}`}
          statusColor={getVideoResolutionStatus(width, height)}
        />
      )}
      {aspect && <Field label="Aspect ratio" value={aspect} />}
      {fps ? (
        <Field
          label="Frame rate"
          value={`${Math.round(fps * 100) / 100} fps`}
          statusColor={getFpsStatus(fps)}
        />
      ) : null}
      {codec && <Field label="Codec" value={String(codec)} />}
      {bitrateKbps !== null && bitrateKbps > 0 && (
        <Field
          label="Bitrate"
          value={
            bitrateKbps >= 1000
              ? `${(bitrateKbps / 1000).toFixed(1)} Mbps`
              : `${bitrateKbps} kbps`
          }
          statusColor={
            width && height
              ? getVideoBitrateStatus(bitrateKbps, width, height, fps, codec)
              : undefined
          }
        />
      )}

      <div style={{ marginTop: 6 }}>
        <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb={4}>
          Audio
        </Text>
        <Stack gap={4}>
          {audioCodec && <Field label="Codec" value={String(audioCodec)} />}
          {channelsStr && <Field label="Channels" value={channelsStr} />}
          {audioBitrateKbps !== null && audioBitrateKbps > 0 && (
            <Field
              label="Bitrate"
              value={`${audioBitrateKbps} kbps`}
              statusColor={getBitrateStatusColor(audioBitrateKbps)}
            />
          )}
          {audioRateHz !== null && (
            <Field
              label="Sample rate"
              value={`${(audioRateHz / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kHz`}
              statusColor={getSampleRateStatusColor(audioRateHz)}
            />
          )}
          {!hasAudioInfo && (
            <Text size="xs" c="dimmed">
              No audio track info indexed.
            </Text>
          )}
        </Stack>
      </div>

      {metadata?.format && <SourceMetadata format={metadata.format} />}
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

function getResolutionStatusColor(maxDimension: number): 'green' | 'yellow' | 'red' {
  if (maxDimension <= 1024) return 'green';
  if (maxDimension <= 2048) return 'yellow';
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

function ImageStats({
  metadata,
  width,
  height
}: {
  metadata: ExtractedMetadata;
  width?: number;
  height?: number;
}) {
  const maxDimension = width && height ? Math.max(width, height) : 0;
  const aspectRatio = width && height ? formatAspectRatio(width, height) : null;
  const bitDepth = metadata.image?.bitDepth;
  const colorType = metadata.image?.colorType;

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
          Image
        </Text>
      </Group>

      {width && height && (
        <Field
          label="Resolution"
          value={`${width} × ${height} px`}
          statusColor={getResolutionStatusColor(maxDimension)}
        />
      )}
      {width && (
        <Field
          label="Width"
          value={`${width} px`}
          statusColor={getResolutionStatusColor(width)}
        />
      )}
      {height && (
        <Field
          label="Height"
          value={`${height} px`}
          statusColor={getResolutionStatusColor(height)}
        />
      )}
      {bitDepth && (
        <Field
          label="Bit depth"
          value={`${bitDepth}-bit${colorType ? ` ${colorType}` : ''}`}
        />
      )}
      {aspectRatio && <Field label="Aspect ratio" value={aspectRatio} />}

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

/**
 * Status capsule gradients: [start, end].
 * Dark theme: the color fades into a very dark shade of itself.
 * Light theme: the color fades into a brighter shade of itself.
 */
const STATUS_GRADIENTS = {
  dark: {
    green: ['#22c55e', '#052e16'],
    yellow: ['#eab308', '#3d3000'],
    red: ['#ef4444', '#450a0a']
  },
  light: {
    green: ['#22c55e', '#bbf7d0'],
    yellow: ['#eab308', '#fef08a'],
    red: ['#ef4444', '#fecaca']
  }
} as const;

function Field({
  label,
  value,
  statusColor
}: {
  label: string;
  value: string;
  statusColor?: 'green' | 'yellow' | 'red';
}) {
  const scheme = useComputedColorScheme('dark');
  const colors = statusColor ? STATUS_GRADIENTS[scheme === 'light' ? 'light' : 'dark'][statusColor] : null;

  return (
    <Group justify="space-between" align="flex-end" wrap="nowrap">
      <div>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        <Text size="sm">{value}</Text>
      </div>
      {colors && (
        <div
          title={`Budget status: ${statusColor}`}
          style={{
            width: 18,
            height: 8,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`,
            marginBottom: 6,
            flexShrink: 0
          }}
        />
      )}
    </Group>
  );
}