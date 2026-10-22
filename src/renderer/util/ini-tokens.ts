/**
 * Tiny INI tokenizer used for syntax highlighting in the text viewer.
 *
 * Pure and dependency-free. Every line is split into tokens whose `text`
 * values concatenate back to the original line, so rendering the tokens never
 * changes what the user sees, only how it is colored.
 *
 * Rules (kept conservative so odd files never look wrong):
 *  - `;` or `#` at the start of a line is a comment.
 *  - `[Section]` is a section header (anything after the `]` is parsed as a tail).
 *  - `key = value` splits on the first `=`. Without an `=`, a `key: value`
 *    line is accepted only when the key has no spaces and it isn't `://`.
 *  - An inline comment starts with `;` that follows whitespace, outside
 *    double quotes. `#` is NOT an inline comment, because values like
 *    `color = #ff0000` are common.
 *  - Lines that don't match any rule stay plain.
 */

export type IniTokenType =
  | 'plain'
  | 'comment'
  | 'section'
  | 'key'
  | 'punct'
  | 'string'
  | 'number'
  | 'bool'
  | 'value';

export interface IniToken {
  type: IniTokenType;
  text: string;
}

const INI_LIKE_EXTS = new Set(['ini', 'cfg']);

/** Extensions that get INI highlighting. */
export function isIniLikeExtension(ext: string): boolean {
  return INI_LIKE_EXTS.has(ext.replace(/^\./, '').toLowerCase());
}

const tok = (type: IniTokenType, text: string): IniToken => ({ type, text });

/** Splits "value ; comment" at the first `;` that follows whitespace and sits
 *  outside double quotes. Returns [value, comment]; comment is '' if none. */
function splitInlineComment(s: string): [string, string] {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && c === ';' && (i === 0 || /\s/.test(s[i - 1]))) {
      return [s.slice(0, i), s.slice(i)];
    }
  }
  return [s, ''];
}

function classifyValue(v: string): IniTokenType {
  if (/^"[^"]*"$/.test(v)) return 'string';
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v) || /^0x[0-9a-f]+$/i.test(v)) {
    return 'number';
  }
  if (/^(true|false|yes|no|on|off)$/i.test(v)) return 'bool';
  return 'value';
}

/** Everything after the separator (or after `]`): value plus optional comment. */
function tokenizeTail(rest: string): IniToken[] {
  const out: IniToken[] = [];
  const lead = /^\s*/.exec(rest)![0];
  if (lead) out.push(tok('plain', lead));
  const [raw, comment] = splitInlineComment(rest.slice(lead.length));
  const value = raw.trimEnd();
  const gap = raw.slice(value.length);
  if (value) out.push(tok(classifyValue(value), value));
  if (gap) out.push(tok('plain', gap));
  if (comment) out.push(tok('comment', comment));
  return out;
}

function findSeparator(body: string): number {
  const eq = body.indexOf('=');
  if (eq !== -1) return eq;
  const colon = body.indexOf(':');
  if (colon > 0 && !/\s/.test(body.slice(0, colon)) && !body.startsWith('//', colon + 1)) {
    return colon;
  }
  return -1;
}

export function tokenizeIniLine(line: string): IniToken[] {
  const lead = /^\s*/.exec(line)![0];
  const body = line.slice(lead.length);
  if (!body) return line ? [tok('plain', line)] : [];

  const out: IniToken[] = lead ? [tok('plain', lead)] : [];

  if (body[0] === ';' || body[0] === '#') {
    out.push(tok('comment', body));
    return out;
  }

  if (body[0] === '[') {
    const close = body.indexOf(']');
    if (close > 0) {
      out.push(tok('section', body.slice(0, close + 1)));
      out.push(...tokenizeTail(body.slice(close + 1)));
      return out;
    }
  }

  const sep = findSeparator(body);
  if (sep <= 0) {
    out.push(tok('plain', body));
    return out;
  }

  const keyRaw = body.slice(0, sep);
  const key = keyRaw.trimEnd();
  out.push(tok('key', key));
  if (keyRaw.length > key.length) out.push(tok('plain', keyRaw.slice(key.length)));
  out.push(tok('punct', body[sep]));
  out.push(...tokenizeTail(body.slice(sep + 1)));
  return out;
}

/** One token array per line. Line endings are not included in the tokens. */
export function tokenizeIni(text: string): IniToken[][] {
  return text.split(/\r\n|\r|\n/).map(tokenizeIniLine);
}
