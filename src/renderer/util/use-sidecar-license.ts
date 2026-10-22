import { useCallback, useEffect, useRef, useState } from 'react';

// Windows and macOS file systems are case-insensitive, so LICENSE.txt,
// License.txt and license.txt are the same file there. Trying all three
// only produced extra 404s in the console.
const CASE_INSENSITIVE_FS =
  typeof navigator !== 'undefined' && /win|mac/i.test(navigator.platform || navigator.userAgent);

const CANDIDATE_NAMES = CASE_INSENSITIVE_FS
  ? ['LICENSE.txt', 'LICENSE.md', 'LICENSE']
  : [
      'LICENSE.txt',
      'License.txt',
      'license.txt',
      'LICENSE.md',
      'License.md',
      'license.md',
      'LICENSE',
      'License'
    ];

/** Name used when the user creates a license from the app. */
export const NEW_LICENSE_FILENAME = 'license.txt';

const LICENSE_NAMES_LOWER = new Set(CANDIDATE_NAMES.map((n) => n.toLowerCase()));

/** True when a file name is one of the license names this hook looks for
 *  (case-insensitive: LICENSE, license.txt, License.md ...). */
export function isLicenseFilename(filename: string): boolean {
  return LICENSE_NAMES_LOWER.has(filename.toLowerCase());
}

interface FoundLicense {
  text: string;
  /** The file name it was found under (so editing writes back to the same file). */
  name: string;
}

// Per-folder cache so flipping between files in the same folder doesn't
// re-fire failed fetches every click. Keyed on `${libraryId}::${parentDir}`.
// Cleared implicitly on app reload; that's fine, it's just a perf cache.
const folderCache = new Map<string, FoundLicense | null>();

// Every mounted useSidecarLicense instance listens here, so a save made in one
// place (metadata panel, text viewer) shows up in all the others right away.
type LicenseListener = (key: string, value: FoundLicense | null) => void;
const listeners = new Set<LicenseListener>();

function cacheKey(libraryId: string, parentDir: string): string {
  return `${libraryId}::${parentDir}`;
}

function setCached(key: string, value: FoundLicense | null): void {
  folderCache.set(key, value);
  for (const listener of listeners) listener(key, value);
}

/**
 * Tell every open license view that a license FILE was just saved by someone
 * who already knows its exact name, e.g. the text viewer editing license.txt
 * itself. It only updates the cache when that file is the one the folder's
 * license lookup resolves to (another candidate name wins otherwise).
 */
export function publishLicense(
  libraryId: string,
  parentDir: string,
  text: string,
  name: string
): void {
  const key = cacheKey(libraryId, parentDir);
  const cached = folderCache.get(key);
  // Nothing cached yet: the next lookup will read the new file anyway.
  if (cached === undefined) return;
  // A different candidate file is the folder's license; leave it alone.
  if (cached && cached.name.toLowerCase() !== name.toLowerCase()) return;
  setCached(key, { text, name: cached ? cached.name : name });
}

/**
 * Looks for a sidecar LICENSE file in the same folder as the given file and
 * returns its text and file name, or null if none of the common filenames were
 * found. Uses the wh3d-file://<libraryId>/rel/<path> route, so this works for
 * any file the scanner hasn't tracked as a FileRecord (license files aren't a
 * supported model extension).
 *
 * `update` tells the hook a license was just saved (created or edited), so the
 * panel shows it right away without another lookup. Every other component
 * using this hook for the same folder updates too.
 */
export function useSidecarLicense(
  libraryId: string,
  parentDir: string
): {
  text: string | null;
  name: string | null;
  loading: boolean;
  update: (text: string, name: string) => void;
} {
  const [found, setFound] = useState<FoundLicense | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Always bump, so a slow lookup from a previous folder can never
    // overwrite the result for this one (including cache hits).
    const requestId = ++requestIdRef.current;

    const key = cacheKey(libraryId, parentDir);
    const cached = folderCache.get(key);
    if (cached !== undefined) {
      setFound(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFound(null);

    (async () => {
      for (const name of CANDIDATE_NAMES) {
        const relPath = parentDir ? `${parentDir}/${name}` : name;
        try {
          const res = await fetch(
            `wh3d-file://${libraryId}/rel/${encodeURIComponent(relPath)}`
          );
          if (requestIdRef.current !== requestId) return; // stale, folder changed since
          if (!res.ok) continue;
          const body = await res.text();
          if (requestIdRef.current !== requestId) return;
          const result = { text: body, name };
          folderCache.set(key, result);
          setFound(result);
          setLoading(false);
          return;
        } catch {
          // Try the next candidate name.
        }
      }
      if (requestIdRef.current !== requestId) return;
      folderCache.set(key, null);
      setFound(null);
      setLoading(false);
    })();
  }, [libraryId, parentDir]);

  // Follow saves made through another instance of this hook (or publishLicense).
  useEffect(() => {
    const key = cacheKey(libraryId, parentDir);
    const listener: LicenseListener = (changedKey, value) => {
      if (changedKey !== key) return;
      // The saved value is newer than any lookup still in flight.
      requestIdRef.current++;
      setFound(value);
      setLoading(false);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [libraryId, parentDir]);

  const update = useCallback(
    (text: string, name: string) => {
      setCached(cacheKey(libraryId, parentDir), { text, name });
    },
    [libraryId, parentDir]
  );

  return { text: found?.text ?? null, name: found?.name ?? null, loading, update };
}