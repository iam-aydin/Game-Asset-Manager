import { Fragment, useMemo } from 'react';
import { useComputedColorScheme } from '@mantine/core';

// Files bigger than this render as plain text: one <span> per token gets heavy.
const HIGHLIGHT_MAX_CHARS = 300_000;

export type HtmlTokenType =
  | 'plain'
  | 'comment'
  | 'doctype'
  | 'tag'
  | 'punct'
  | 'attr'
  | 'string'
  | 'entity';

export interface HtmlToken {
  type: HtmlTokenType;
  text: string;
}

const TAG_NAME = /[A-Za-z][\w:-]*/y;
const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|\w+);/y;

/**
 * Splits HTML into colorable tokens, one array per line. The characters are
 * never changed, so joining all token texts gives the original file back.
 * Contents of <script> and <style> stay plain (they are not HTML).
 */
export function tokenizeHtml(src: string): HtmlToken[][] {
  const flat: HtmlToken[] = [];
  const push = (type: HtmlTokenType, text: string) => {
    if (text) flat.push({ type, text });
  };
  const lowerSrc = src.toLowerCase();
  const n = src.length;
  let i = 0;

  while (i < n) {
    const ch = src[i];

    // <!-- comment -->
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const j = end < 0 ? n : end + 3;
      push('comment', src.slice(i, j));
      i = j;
      continue;
    }

    // <!DOCTYPE html> and <![CDATA[ ... ]]> style declarations
    if (ch === '<' && src[i + 1] === '!') {
      const end = src.indexOf('>', i + 2);
      const j = end < 0 ? n : end + 1;
      push('doctype', src.slice(i, j));
      i = j;
      continue;
    }

    // <tag attr="value"> and </tag>
    if (ch === '<' && /[A-Za-z/]/.test(src[i + 1] ?? '')) {
      let j = i + 1;
      let open = '<';
      if (src[j] === '/') {
        open = '</';
        j++;
      }
      push('punct', open);

      TAG_NAME.lastIndex = j;
      const m = TAG_NAME.exec(src);
      const name = m ? m[0] : '';
      push('tag', name);
      j += name.length;

      while (j < n && src[j] !== '>') {
        const c = src[j];
        if (/\s/.test(c)) {
          let k = j;
          while (k < n && /\s/.test(src[k])) k++;
          push('plain', src.slice(j, k));
          j = k;
        } else if (c === '/' || c === '=') {
          push('punct', c);
          j++;
        } else if (c === '"' || c === "'") {
          const end = src.indexOf(c, j + 1);
          const k = end < 0 ? n : end + 1;
          push('string', src.slice(j, k));
          j = k;
        } else {
          let k = j;
          while (k < n && !/[\s=/>"']/.test(src[k])) k++;
          if (k === j) k++;
          push('attr', src.slice(j, k));
          j = k;
        }
      }
      if (j < n) {
        push('punct', '>');
        j++;
      }
      i = j;

      // <script> / <style>: everything up to the closing tag is not HTML.
      const lower = name.toLowerCase();
      if (open === '<' && (lower === 'script' || lower === 'style')) {
        const close = lowerSrc.indexOf('</' + lower, i);
        const k = close < 0 ? n : close;
        push('plain', src.slice(i, k));
        i = k;
      }
      continue;
    }

    // &amp; &#169; &nbsp;
    if (ch === '&') {
      ENTITY.lastIndex = i;
      const m = ENTITY.exec(src);
      if (m) {
        push('entity', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Plain text up to the next "<" or "&".
    let k = i + 1;
    while (k < n && src[k] !== '<' && src[k] !== '&') k++;
    push('plain', src.slice(i, k));
    i = k;
  }

  // Cut the flat token list into lines.
  const lines: HtmlToken[][] = [[]];
  for (const t of flat) {
    const parts = t.text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ type: t.type, text: part });
    });
  }
  return lines;
}

type InkColor = Exclude<HtmlTokenType, 'plain'>;

const HTML_DARK: Record<InkColor, string> = {
  comment: '#7f848e',
  doctype: '#c678dd',
  tag: '#e06c75',
  punct: '#abb2bf',
  attr: '#d19a66',
  string: '#98c379',
  entity: '#56b6c2'
};

const HTML_LIGHT: Record<InkColor, string> = {
  comment: '#6b7280',
  doctype: '#7e3fbf',
  tag: '#b3261e',
  punct: '#6b7280',
  attr: '#b45309',
  string: '#2e7d32',
  entity: '#0b7285'
};

/** Syntax-highlighted HTML source. Same characters as the file, only colored. */
export function HtmlSourceText({ content }: { content: string }) {
  const scheme = useComputedColorScheme('dark');
  const palette = scheme === 'light' ? HTML_LIGHT : HTML_DARK;
  const lines = useMemo(
    () => (content.length > HIGHLIGHT_MAX_CHARS ? null : tokenizeHtml(content)),
    [content]
  );

  if (!lines) return <>{content}</>;

  return (
    <>
      {lines.map((tokens, i) => (
        <Fragment key={i}>
          {tokens.map((t, j) =>
            t.type === 'plain' ? (
              t.text
            ) : (
              <span
                key={j}
                style={{
                  color: palette[t.type],
                  fontStyle: t.type === 'comment' ? 'italic' : undefined,
                  fontWeight: t.type === 'tag' ? 600 : undefined
                }}
              >
                {t.text}
              </span>
            )
          )}
          {i < lines.length - 1 ? '\n' : ''}
        </Fragment>
      ))}
    </>
  );
}
