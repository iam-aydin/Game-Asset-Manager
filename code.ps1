# patch-mixed.ps1  -- run from the project root
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$pending = [ordered]@{}

function Get-Doc([string]$rel) {
  $full = Join-Path $root $rel
  if ($pending.Contains($full)) { return $pending[$full] }
  if (-not (Test-Path $full)) { throw "Missing file: $rel" }
  $raw = [System.IO.File]::ReadAllText($full)
  $doc = @{ Rel = $rel; Full = $full; Crlf = $raw.Contains("`r`n"); Text = $raw.Replace("`r`n", "`n") }
  $pending[$full] = $doc
  return $doc
}
function Add-Edit([string]$rel, [string]$old, [string]$new) {
  $doc = Get-Doc $rel
  $old = $old.Replace("`r`n", "`n"); $new = $new.Replace("`r`n", "`n")
  $count = ([regex]::Matches($doc.Text, [regex]::Escape($old))).Count
  if ($count -ne 1) { throw "Anchor matched $count times (need exactly 1) in $rel :`n$old" }
  $doc.Text = $doc.Text.Replace($old, $new)
}
function Set-Whole([string]$rel, [string]$content) {
  $doc = Get-Doc $rel
  $doc.Text = $content.Replace("`r`n", "`n")
}

$app  = 'src\renderer\App.tsx'
$q    = 'src\main\containers\query.ts'
$prot = 'src\main\protocol\asset-protocols.ts'
$grid = 'src\renderer\components\ThumbGrid.tsx'

if (-not (Get-Doc $app).Text.Contains('GLOBAL_FAV_KEY')) { throw 'patch-global.ps1 must be applied first.' }
if (-not (Get-Doc $q).Text.Contains('queryContainerFiles')) { throw 'src\main\containers\query.ts is missing (patch-global).' }

# ───────── main: container query across all libraries ─────────
Set-Whole $q @'
import * as manager from '@main/libraries/manager';
import type { OpenLibrary } from '@main/libraries/manager';
import type { FileQueryRequest, FileRecord } from '@shared/types';
import * as store from './store';

/** Files from a library other than the requesting one get id = ordinal * SPAN + localId. */
export const LIB_ID_SPAN = 1000000000;

/**
 * All files of a global container, from every open library, in stored order,
 * with the simple filters applied (search, extension, rating, color).
 */
export function queryContainerFiles(
  home: OpenLibrary,
  req: Omit<FileQueryRequest, 'libraryId'>
): FileRecord[] {
  if (req.collectionId == null) return [];
  const c = store.get(req.collectionId);
  if (!c) return [];
  const ordinals = new Map(manager.listLibraries().map((l, i) => [l.id, i + 1] as const));
  const exts =
    req.extensions && req.extensions.length > 0
      ? new Set(req.extensions.map((e) => e.toLowerCase()))
      : null;
  const labels =
    req.colorLabels && req.colorLabels.length > 0 ? new Set<string>(req.colorLabels) : null;
  const needle = req.query?.trim().toLowerCase() ?? '';
  const out: FileRecord[] = [];
  for (const it of c.items) {
    const lib = manager.getOpenLibrary(it.libraryId);
    if (!lib) continue;
    const base = lib.files.getByRelPath(it.relPath);
    // getByRelPath has no thumbnail join; getById has.
    const f = base ? lib.files.getById(base.id) : null;
    if (!f) continue;
    if (exts && !exts.has(f.ext.toLowerCase())) continue;
    if (req.minRating && f.rating < req.minRating) continue;
    if (labels && (f.colorLabel == null || !labels.has(f.colorLabel))) continue;
    if (needle && !f.relPath.toLowerCase().includes(needle)) continue;
    out.push(
      lib.entry.id === home.entry.id
        ? f
        : { ...f, id: (ordinals.get(lib.entry.id) ?? 1) * LIB_ID_SPAN + f.id }
    );
    if (req.limit && out.length >= req.limit) break;
  }
  return out;
}
'@

# ───────── protocol: decode composite ids ─────────
Add-Edit $prot @'
  return { libraryId, fileId };
}

/**
 * URL shape: wh3d-file://<libraryId>/rel/
'@ @'
  return { libraryId, fileId: fileId >= 1000000000 ? fileId % 1000000000 : fileId };
}

/**
 * URL shape: wh3d-file://<libraryId>/rel/
'@

# ───────── ThumbGrid: drag uses local id ─────────
Add-Edit $grid 'ipc.startFileDrag(file.libraryId, file.id);' 'ipc.startFileDrag(file.libraryId, file.id % 1000000000);'

# ───────── App.tsx ─────────
Add-Edit $app @'
function readStoredList(key: string): string[] {
'@ @'
/** Container files from other libraries carry id = ordinal * SPAN + localId (see main/containers/query.ts). */
const LIB_ID_SPAN = 1000000000;

function decodeFileRecord(f: FileRecord): FileRecord {
  return f.id >= LIB_ID_SPAN ? { ...f, id: f.id % LIB_ID_SPAN } : f;
}

/** libraryId -> local file ids, for sending bulk actions to each file's own library. */
function groupLocalIds(list: FileRecord[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const f of list) {
    const arr = m.get(f.libraryId) ?? [];
    arr.push(f.id % LIB_ID_SPAN);
    m.set(f.libraryId, arr);
  }
  return m;
}

function readStoredList(key: string): string[] {
'@

Add-Edit $app @'
  const [favoriteFolders, setFavoriteFoldersState] = useState<string[]>([]);
'@ @'
  // Latest decoded selection, readable from callbacks defined before it exists.
  const selectedFilesRef = useRef<FileRecord[]>([]);
  const [favoriteFolders, setFavoriteFoldersState] = useState<string[]>([]);
'@

Add-Edit $app 'files.slice(0, 100).map((f) => f.id)' 'files.filter((f) => f.libraryId === selectedLibraryId).slice(0, 100).map((f) => f.id)'

Add-Edit $app @'
      if (event.libraryId !== s.selectedLibraryId) return;
'@ @'
      // Changes made to a container file that lives in ANOTHER library.
      if (event.libraryId !== s.selectedLibraryId && s.selectedLibraryId) {
        if (event.kind === 'collections-changed') void refreshCollections(s.selectedLibraryId);
        if (
          (event.kind === 'collections-changed' || event.kind === 'files-changed') &&
          s.selectedCollectionId != null
        ) {
          void refreshFiles(
            s.selectedLibraryId,
            s.selectedFolderPath,
            s.selectedCollectionId,
            s.searchQuery,
            s.selectedExtensions,
            s.selectedTagIds,
            s.minRating,
            s.selectedColorLabels,
            s.sort,
            s.viewScope,
            s.duplicatesOnly
          );
        }
        if (event.kind === 'collections-changed' || event.kind === 'files-changed') return;
      }
      if (event.libraryId !== s.selectedLibraryId) return;
'@

Add-Edit $app 'setActiveAudio({ fileId: clickedFile.id, autoPlay: true });' 'setActiveAudio({ fileId: clickedFile.id % LIB_ID_SPAN, autoPlay: true });'
Add-Edit $app 'setActiveAudio({ fileId: first.id, autoPlay: false });' 'setActiveAudio({ fileId: first.id % LIB_ID_SPAN, autoPlay: false });'

Add-Edit $app 'const r = await ipc.deleteFile(f.libraryId, f.id);' 'const r = await ipc.deleteFile(f.libraryId, f.id % LIB_ID_SPAN);'
Add-Edit $app 'const r = await ipc.duplicateFile(f.libraryId, f.id);' 'const r = await ipc.duplicateFile(f.libraryId, f.id % LIB_ID_SPAN);'
Add-Edit $app 'const r = await ipc.moveFile(f.libraryId, f.id, toParentDir);' 'const r = await ipc.moveFile(f.libraryId, f.id % LIB_ID_SPAN, toParentDir);'

Add-Edit $app @'
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      void ipc.rerenderThumb(file.libraryId, fileId).then(() => scheduleThumbRecount());
    },
    [files, scheduleThumbRecount]
'@ @'
      const file =
        files.find((f) => f.id === primaryFileId && f.id % LIB_ID_SPAN === fileId) ??
        files.find((f) => f.id === fileId);
      if (!file) return;
      void ipc
        .rerenderThumb(file.libraryId, file.id % LIB_ID_SPAN)
        .then(() => scheduleThumbRecount());
    },
    [files, primaryFileId, scheduleThumbRecount]
'@

# Bulk handlers: send each file to its own library.
Add-Edit $app 'await ipc.addTagToFiles(selectedLibraryId, selectedIdsArray, tagName);' @'
for (const [lid, ids] of groupLocalIds(selectedFilesRef.current)) {
        await ipc.addTagToFiles(lid, ids, tagName);
      }
'@
Add-Edit $app 'await ipc.removeTagFromFiles(selectedLibraryId, selectedIdsArray, tagId);' @'
// Tag ids belong to one library, so only files of the current library are touched.
      await ipc.removeTagFromFiles(
        selectedLibraryId,
        groupLocalIds(selectedFilesRef.current).get(selectedLibraryId) ?? [],
        tagId
      );
'@
Add-Edit $app 'await ipc.setFileOrientations(selectedLibraryId, selectedIdsArray, orientation);' @'
for (const [lid, ids] of groupLocalIds(selectedFilesRef.current)) {
        await ipc.setFileOrientations(lid, ids, orientation);
      }
'@
Add-Edit $app 'await ipc.rerenderThumbs(selectedLibraryId, selectedIdsArray);' @'
for (const [lid, ids] of groupLocalIds(selectedFilesRef.current)) {
      await ipc.rerenderThumbs(lid, ids);
    }
'@
Add-Edit $app 'await ipc.setFileRatings(selectedLibraryId, selectedIdsArray, rating);' @'
for (const [lid, ids] of groupLocalIds(selectedFilesRef.current)) {
        await ipc.setFileRatings(lid, ids, rating);
      }
'@
Add-Edit $app 'await ipc.setFileColorLabels(selectedLibraryId, selectedIdsArray, label);' @'
for (const [lid, ids] of groupLocalIds(selectedFilesRef.current)) {
        await ipc.setFileColorLabels(lid, ids, label);
      }
'@

Add-Edit $app 'await ipc.addFilesToCollection(selectedLibraryId, collectionId, fileIds);' @'
const want = new Set(fileIds);
      const picked = selectedFilesRef.current.filter((f) => want.has(f.id));
      if (picked.length === 0) {
        await ipc.addFilesToCollection(selectedLibraryId, collectionId, fileIds);
        return;
      }
      for (const [lid, ids] of groupLocalIds(picked)) {
        await ipc.addFilesToCollection(lid, collectionId, ids);
      }
'@
Add-Edit $app 'await ipc.removeFilesFromCollection(selectedLibraryId, collectionId, fileIds);' @'
const want = new Set(fileIds);
      const picked = selectedFilesRef.current.filter((f) => want.has(f.id));
      if (picked.length === 0) {
        await ipc.removeFilesFromCollection(selectedLibraryId, collectionId, fileIds);
        return;
      }
      for (const [lid, ids] of groupLocalIds(picked)) {
        await ipc.removeFilesFromCollection(lid, collectionId, ids);
      }
'@

# Decoded views for the side panels.
Add-Edit $app @'
    () => files.find((f) => f.id === primaryFileId) ?? null,
'@ @'
    () => {
      const f = files.find((x) => x.id === primaryFileId);
      return f ? decodeFileRecord(f) : null;
    },
'@
Add-Edit $app '() => files.filter((f) => selectedFileIds.has(f.id)),' '() => files.filter((f) => selectedFileIds.has(f.id)).map(decodeFileRecord),'
Add-Edit $app @'
  const [folderMenu, setFolderMenu] = useState<FolderMenuState>({
'@ @'
  selectedFilesRef.current = selectedFiles;

  const [folderMenu, setFolderMenu] = useState<FolderMenuState>({
'@

# Panels use the file's own library.
Add-Edit $app @'
      libraryId={selectedLibraryId}
      file={primaryFile}
      selectionCount
'@ @'
      libraryId={primaryFile?.libraryId ?? selectedLibraryId}
      file={primaryFile}
      selectionCount
'@
Add-Edit $app @'
        libraryId={selectedLibraryId}
        primaryFile={primaryFile}
'@ @'
        libraryId={primaryFile?.libraryId ?? selectedLibraryId}
        primaryFile={primaryFile}
'@
Add-Edit $app @'
        libraryId={selectedLibraryId}
        file={primaryFile}
'@ @'
        libraryId={primaryFile?.libraryId ?? selectedLibraryId}
        file={primaryFile}
'@
Add-Edit $app @'
        libraryId={selectedLibraryId}
        left={selectedFiles[0] ?? null}
'@ @'
        libraryId={selectedFiles[0]?.libraryId ?? selectedLibraryId}
        left={selectedFiles[0] ?? null}
'@
Add-Edit $app @'
        files={selectedFiles}
        onClose={() => setBatchRenameOpen(false)}
'@ @'
        files={selectedFiles.filter((f) => f.libraryId === selectedLibraryId)}
        onClose={() => setBatchRenameOpen(false)}
'@
Add-Edit $app @'
          libraryId={selectedLibraryId}
          selectedFiles={selectedFiles}
'@ @'
          libraryId={primaryFile?.libraryId ?? selectedLibraryId}
          selectedFiles={selectedFiles}
'@

foreach ($doc in $pending.Values) {
  $out = if ($doc.Crlf) { $doc.Text.Replace("`n", "`r`n") } else { $doc.Text }
  $bak = $doc.Full + '.bak4'
  if (-not (Test-Path $bak)) { Copy-Item $doc.Full $bak }
  [System.IO.File]::WriteAllText($doc.Full, $out, $utf8)
  Write-Host ("patched  " + $doc.Rel)
}
Write-Host "`nDone. Run:  npm run typecheck   then   npm run dev"