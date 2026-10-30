export interface SubCue {
  start: number;
  end: number;
  text: string;
}

const toSec = (s: string): number => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
};

/** Parses WebVTT text (the main process already converts .srt / .ass to it). */
export function parseVtt(src: string): SubCue[] {
  const out: SubCue[] = [];
  for (const block of src.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = toSec(a);
    const end = toSec(b.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
    if (text) out.push({ start, end, text });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Text of every cue that is showing at time t (seconds). */
export function cueAt(cues: SubCue[], t: number): string {
  let r = '';
  for (const c of cues) {
    if (c.start > t) break;
    if (t < c.end) r += (r ? '\n' : '') + c.text;
  }
  return r;
}