import { describe, expect, it } from 'vitest';
import { isIniLikeExtension, tokenizeIni, tokenizeIniLine } from './ini-tokens';

const types = (line: string) => tokenizeIniLine(line).map((t) => t.type);
const join = (line: string) =>
  tokenizeIniLine(line)
    .map((t) => t.text)
    .join('');

describe('isIniLikeExtension', () => {
  it('accepts ini and cfg with or without a dot, any case', () => {
    expect(isIniLikeExtension('ini')).toBe(true);
    expect(isIniLikeExtension('.INI')).toBe(true);
    expect(isIniLikeExtension('cfg')).toBe(true);
    expect(isIniLikeExtension('txt')).toBe(false);
  });
});

describe('tokenizeIniLine', () => {
  it('handles blank lines', () => {
    expect(tokenizeIniLine('')).toEqual([]);
    expect(types('   ')).toEqual(['plain']);
  });

  it('detects comments at the start of a line', () => {
    expect(types('; hello')).toEqual(['comment']);
    expect(types('# hello')).toEqual(['comment']);
    expect(types('   ; indented')).toEqual(['plain', 'comment']);
  });

  it('detects sections, with an optional trailing comment', () => {
    expect(types('[Core.System]')).toEqual(['section']);
    expect(types('[Core] ; engine')).toEqual(['section', 'plain', 'comment']);
  });

  it('splits key = value', () => {
    expect(types('Width=1920')).toEqual(['key', 'punct', 'number']);
    expect(types('Fullscreen = true')).toEqual(['key', 'plain', 'punct', 'plain', 'bool']);
    expect(types('Title = "My Game"')).toEqual(['key', 'plain', 'punct', 'plain', 'string']);
    expect(types('Path = C:\\Games\\Foo')).toEqual(['key', 'plain', 'punct', 'plain', 'value']);
  });

  it('supports Unreal-style keys with prefixes', () => {
    const t = tokenizeIniLine('+Paths=(Path="/Game/Maps")');
    expect(t[0]).toEqual({ type: 'key', text: '+Paths' });
    expect(t[1]).toEqual({ type: 'punct', text: '=' });
  });

  it('only splits on the first =', () => {
    const t = tokenizeIniLine('url = https://x.com/?a=b');
    expect(t.find((x) => x.type === 'value')?.text).toBe('https://x.com/?a=b');
  });

  it('treats ; after whitespace as an inline comment, outside quotes', () => {
    expect(types('Gravity = 9.8 ; m/s')).toEqual([
      'key',
      'plain',
      'punct',
      'plain',
      'number',
      'plain',
      'comment'
    ]);
    const quoted = tokenizeIniLine('Title = "a ; b"');
    expect(quoted.some((t) => t.type === 'comment')).toBe(false);
    const glued = tokenizeIniLine('Path = a;b');
    expect(glued.some((t) => t.type === 'comment')).toBe(false);
  });

  it('does not treat # in a value as a comment', () => {
    const t = tokenizeIniLine('Color = #ff0000');
    expect(t.some((x) => x.type === 'comment')).toBe(false);
    expect(t.find((x) => x.type === 'value')?.text).toBe('#ff0000');
  });

  it('accepts key: value only for simple keys', () => {
    expect(types('name: Bob')).toEqual(['key', 'punct', 'plain', 'value']);
    expect(types('see https://example.com')).toEqual(['plain']);
    expect(types('two words: nope')).toEqual(['plain']);
  });

  it('leaves unrecognized lines plain', () => {
    expect(types('just some text')).toEqual(['plain']);
    expect(types('= no key')).toEqual(['plain']);
  });

  it('classifies numbers and booleans', () => {
    const val = (s: string) => tokenizeIniLine(s).find((t) => t.text.trim() && t.type !== 'key' && t.type !== 'punct')!.type;
    expect(val('a=-1.5e3')).toBe('number');
    expect(val('a=0xFF')).toBe('number');
    expect(val('a=Yes')).toBe('bool');
    expect(val('a=off')).toBe('bool');
    expect(val('a=1.2.3')).toBe('value');
  });

  it('round-trips: token text always rebuilds the original line', () => {
    const lines = [
      '',
      '   ',
      '; comment',
      '  # indented comment',
      '[Section] ; tail',
      '[Broken',
      'Key = Value ; c',
      'Key   =   "a ; b"   ',
      'key:value',
      '+Array=(X=1,Y=2)',
      '\tTabbed = 1',
      'weird = = =',
      'trailing = ',
      'Color = #fff'
    ];
    for (const l of lines) expect(join(l)).toBe(l);
  });
});

describe('tokenizeIni', () => {
  it('returns one token array per line and handles CRLF', () => {
    const out = tokenizeIni('[A]\r\nx=1\r\n; c');
    expect(out).toHaveLength(3);
    expect(out[0][0].type).toBe('section');
    expect(out[2][0].type).toBe('comment');
  });
});
