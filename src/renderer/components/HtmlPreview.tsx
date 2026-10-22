import { useMemo } from 'react';
import { Box } from '@mantine/core';
import type { FileRecord } from '@shared/types';

interface HtmlPreviewProps {
  libraryId: string;
  file: FileRecord;
  /** The HTML text of the file (TextPreview has already fetched it). */
  content: string;
  /**
   * Whether JavaScript in the page may run. Defaults to true. Pass false to
   * get the fully locked-down (static) preview.
   */
  allowScripts?: boolean;
}

/**
 * Builds the Content-Security-Policy put into every rendered page.
 *   - no frames, no plugins, no form posts
 *   - no network: images / CSS / fonts / media / scripts may only come from the
 *     wh3d-file:// route (the library) or inline data: URIs
 *   - connect-src 'none' stops fetch / XHR / WebSocket, so scripts can't phone home
 *   - scripts are allowed (inline + from the library) only when allowScripts is true
 * A page's own CSP <meta> can only make this stricter, never looser.
 */
export function buildCsp(allowScripts: boolean): string {
  return [
    "default-src 'none'",
    allowScripts ? "script-src 'unsafe-inline' wh3d-file:" : "script-src 'none'",
    'img-src wh3d-file: data:',
    "style-src wh3d-file: 'unsafe-inline'",
    'font-src wh3d-file: data:',
    'media-src wh3d-file: data:',
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    'base-uri wh3d-file:'
  ].join('; ');
}

/**
 * Where relative URLs in the page (images/foo.png, style.css) resolve to.
 *
 * NOTE: this assumes the main-process `wh3d-file://` handler also answers
 *   wh3d-file://<libraryId>/dir/<folder path inside the library>/<relative file>
 * and refuses anything that escapes the library root. If your handler uses a
 * different shape, this is the only line to change.
 */
export function htmlBaseHref(libraryId: string, file: FileRecord): string {
  const folder = (file.parentDir ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.')
    .map(encodeURIComponent)
    .join('/');
  return `wh3d-file://${libraryId}/dir/${folder ? folder + '/' : ''}`;
}

/**
 * Turns the file's HTML into the document shown in the iframe. The text is
 * parsed with DOMParser first (an inert document: nothing runs or loads), so
 * the CSP and <base> are inserted as the very first things in <head> no matter
 * how odd the original markup is (comments, scripts mentioning "<head>", etc.).
 */
export function buildPreviewDocument(
  html: string,
  baseHref: string,
  allowScripts = true
): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // A page's own <base> or auto-refresh could send the frame somewhere else.
  doc.querySelectorAll('base').forEach((el) => el.remove());
  doc.querySelectorAll('meta[http-equiv]').forEach((el) => {
    const v = el.getAttribute('http-equiv')?.toLowerCase();
    if (v === 'refresh' || v === 'content-security-policy') el.remove();
  });

  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', buildCsp(allowScripts));

  // target=_blank + no allow-popups in the sandbox = clicking a link does nothing.
  const base = doc.createElement('base');
  base.setAttribute('href', baseHref);
  base.setAttribute('target', '_blank');

  doc.head.prepend(csp, base);

  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
  return doctype + doc.documentElement.outerHTML;
}

/** Rendered view of an .html file, locked down inside a sandboxed iframe. */
export function HtmlPreview({ libraryId, file, content, allowScripts = true }: HtmlPreviewProps) {
  const srcDoc = useMemo(
    () => buildPreviewDocument(content, htmlBaseHref(libraryId, file), allowScripts),
    [content, libraryId, file, allowScripts]
  );

  return (
    <Box h="100%" w="100%" style={{ background: '#ffffff' }}>
      <iframe
        title={file.filename}
        // "allow-scripts" lets the page's JavaScript run. NEVER add
        // "allow-same-origin" alongside it: together they let the framed page
        // remove its own sandbox and reach your app. Without it the frame gets
        // an opaque origin; still no popups, no forms, no top navigation.
        sandbox={allowScripts ? 'allow-scripts' : ''}
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#ffffff' }}
      />
    </Box>
  );
}