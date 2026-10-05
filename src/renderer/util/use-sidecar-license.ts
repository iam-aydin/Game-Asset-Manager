import { useEffect, useRef, useState } from 'react';

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

// Per-folder cache so flipping between files in the same folder doesn't
// re-fire failed fetches every click. Keyed on `${libraryId}::${parentDir}`.
// Cleared implicitly on app reload; that's fine, it's just a perf cache.
const folderCache = new Map<string, string | null>();

function cacheKey(libraryId: string, parentDir: string): string {
  return `${libraryId}::${parentDir}`;
}

/**
 * Looks for a sidecar LICENSE file in the same folder as the given file and
 * returns its text, or null if none of the common filenames were found.
 * Uses the wh3d-file://<libraryId>/rel/<path> route, so this works for any
 * file the scanner hasn't tracked as a FileRecord (license files aren't a
 * supported model extension).
 */
export function useSidecarLicense(
  libraryId: string,
  parentDir: string
): { text: string | null; loading: boolean } {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Always bump, so a slow lookup from a previous folder can never
    // overwrite the result for this one (including cache hits).
    const requestId = ++requestIdRef.current;

    const key = cacheKey(libraryId, parentDir);
    const cached = folderCache.get(key);
    if (cached !== undefined) {
      setText(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setText(null);

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
          folderCache.set(key, body);
          setText(body);
          setLoading(false);
          return;
        } catch {
          // Try the next candidate name.
        }
      }
      if (requestIdRef.current !== requestId) return;
      folderCache.set(key, null);
      setText(null);
      setLoading(false);
    })();
  }, [libraryId, parentDir]);

  return { text, loading };
}