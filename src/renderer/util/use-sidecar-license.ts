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

interface FoundLicense {
  text: string;
  /** The file name it was found under (so editing writes back to the same file). */
  name: string;
}

// Per-folder cache so flipping between files in the same folder doesn't
// re-fire failed fetches every click. Keyed on `${libraryId}::${parentDir}`.
// Cleared implicitly on app reload; that's fine, it's just a perf cache.
const folderCache = new Map<string, FoundLicense | null>();

function cacheKey(libraryId: string, parentDir: string): string {
  return `${libraryId}::${parentDir}`;
}

/**
 * Looks for a sidecar LICENSE file in the same folder as the given file and
 * returns its text and file name, or null if none of the common filenames were
 * found. Uses the wh3d-file://<libraryId>/rel/<path> route, so this works for
 * any file the scanner hasn't tracked as a FileRecord (license files aren't a
 * supported model extension).
 *
 * `update` tells the hook a license was just saved (created or edited), so the
 * panel shows it right away without another lookup.
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

  const update = useCallback(
    (text: string, name: string) => {
      const result = { text, name };
      folderCache.set(cacheKey(libraryId, parentDir), result);
      setFound(result);
      setLoading(false);
    },
    [libraryId, parentDir]
  );

  return { text: found?.text ?? null, name: found?.name ?? null, loading, update };
}