import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * Shared by AudioPlayer.tsx and VideoPlayer.tsx.
 * Non-component code lives here (constants, a hook, the pitch node) and the
 * components live in PlayerMenu.tsx, so Vite Fast Refresh stays happy.
 * Change a value here and both players follow.
 */

// ---- Speed -----------------------------------------------------------------

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

export const getSpeedColor = (s: number): string | undefined => {
  if (s < 1) return '#2e7d32'; // Dark Green
  if (s === 1) return undefined; // Non-colored / Default
  if (s <= 1.75) return '#857e22'; // Custom Yellow
  if (s === 2) return '#c15000'; // Custom Dark Orange
  if (s === 3) return '#8b0000'; // Dark Red
  if (s === 4) return '#e03131'; // Red
  return undefined;
};

// ---- Pitch -----------------------------------------------------------------
// off     = no pitch change
// shift   = "Pitch shifter": pitch AND speed change together (like a tape / vinyl)
// correct = "Pitch correction": pitch changes, speed stays the same
// The menu now has ONE pitch slider (default 0) and a "Pitch correction" checkbox:
//   checkbox off ('off' or 'shift') = regular pitch change, speed follows the pitch
//   checkbox on  ('correct')        = pitch only, speed stays the same
export type PitchMode = 'off' | 'shift' | 'correct';

export const PITCH_MIN_ST = -12;
export const PITCH_MAX_ST = 12;

// ---- Modular pitch / volume / speed ------------------------------------------
// Like the Modulator node in an Unreal Sound Cue: each time the sound plays (or
// loops) it picks a random multiplier inside the range the user set, for each
// option that is switched on. 1.00 = unchanged. A modular option REPLACES the
// regular control while it is on (the regular control is greyed out).
export interface ModularSettings {
  pitchOn: boolean;
  pitchMin: number;
  pitchMax: number;
  volumeOn: boolean;
  volumeMin: number;
  volumeMax: number;
  speedOn: boolean;
  speedMin: number;
  speedMax: number;
}

export const MODULAR_MIN = 0.5;
export const MODULAR_MAX = 2;
export const MODULAR_STEP = 0.05;

export const DEFAULT_MODULAR: ModularSettings = {
  pitchOn: false,
  pitchMin: 0.95,
  pitchMax: 1.05,
  volumeOn: false,
  volumeMin: 0.95,
  volumeMax: 1.05,
  speedOn: false,
  speedMin: 0.95,
  speedMax: 1.05
};

export const anyModular = (m: ModularSettings) => m.pitchOn || m.volumeOn || m.speedOn;

/** Snaps a slider value to the 0.05 grid (and removes float noise). */
export const snapModular = (v: number) => Math.round(v * 20) / 20;

/** Rebuilds saved settings (older saves, missing or odd values) into a valid object. */
export const normalizeModular = (raw: unknown): ModularSettings => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (k: string) => r[k] === true;
  const val = (k: string, d: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.min(MODULAR_MAX, Math.max(MODULAR_MIN, v))
      : d;
  };
  const pair = (kMin: string, kMax: string, dMin: number, dMax: number): [number, number] => {
    const a = val(kMin, dMin);
    const b = val(kMax, dMax);
    return a <= b ? [a, b] : [b, a];
  };
  const [pitchMin, pitchMax] = pair('pitchMin', 'pitchMax', DEFAULT_MODULAR.pitchMin, DEFAULT_MODULAR.pitchMax);
  const [volumeMin, volumeMax] = pair('volumeMin', 'volumeMax', DEFAULT_MODULAR.volumeMin, DEFAULT_MODULAR.volumeMax);
  const [speedMin, speedMax] = pair('speedMin', 'speedMax', DEFAULT_MODULAR.speedMin, DEFAULT_MODULAR.speedMax);
  return {
    pitchOn: flag('pitchOn'),
    pitchMin,
    pitchMax,
    volumeOn: flag('volumeOn'),
    volumeMin,
    volumeMax,
    speedOn: flag('speedOn'),
    speedMin,
    speedMax
  };
};

/** One random roll: p = pitch, v = volume, s = speed multipliers. */
export const rollModular = (m: ModularSettings) => {
  const pick = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  return {
    p: pick(m.pitchMin, m.pitchMax),
    v: pick(m.volumeMin, m.volumeMax),
    s: pick(m.speedMin, m.speedMax)
  };
};

// ---- EQ --------------------------------------------------------------------

export const EQ_MAX_DB = 12;
export const EQ_HEADROOM = 0.25;
export const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

// ---- Look ------------------------------------------------------------------

export const sliderThumbStyle = {
  backgroundColor: 'var(--wh3d-slider-thumb-bg, #4c6ef5)',
  border: '2px solid var(--wh3d-slider-thumb-border, #000000)'
};

// ---- Menu sizing: menus flex to the room above the control bar --------------
// When the app window (or the floating preview window) is small, a menu taller
// than the space above the control bar would be clipped at the top of the
// window. Each menu measures that space and caps its height; the content then
// scrolls inside a glass scrollbar (GlassScroll in PlayerMenu.tsx).

const MENU_OFFSET = 8; // Mantine popover default offset from its target
const MENU_EDGE_MARGIN = 10; // breathing room kept at the top of the window
const MENU_MIN_H = 64;

export function useMenuMaxHeight(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  watchRef: React.RefObject<HTMLElement | null>
): number {
  const [maxH, setMaxH] = useState(480);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setMaxH(Math.max(MENU_MIN_H, Math.floor(top - MENU_OFFSET - MENU_EDGE_MARGIN)));
    };
    measure();
    window.addEventListener('resize', measure);
    // Also re-measure when the player itself changes size (floating window resize).
    const ro = new ResizeObserver(measure);
    if (watchRef.current) ro.observe(watchRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [open, anchorRef, watchRef]);
  return maxH;
}

// ---- Pitch correction node -------------------------------------------------
// Shifts pitch WITHOUT changing speed, using only standard Web Audio nodes:
// two delay lines whose delay time ramps up or down (a Doppler effect), cross-
// faded so the jump when a ramp resets is hidden. It is a live effect, so it is
// good for previewing a sound before export, not studio-grade.

const PC_CYCLE_S = 0.1; // length of one delay ramp
const PC_FADE_S = 0.05; // cross-fade between the two delay lines

export interface PitchCorrector {
  input: GainNode;
  output: GainNode;
  /** 0 = bypass (audio passes straight through). */
  setSemitones(st: number): void;
  dispose(): void;
}

const makeRampBuffer = (ctx: BaseAudioContext, rising: boolean): AudioBuffer => {
  const len = Math.max(2, Math.round(PC_CYCLE_S * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rising ? i / len : (len - i) / len;
  return buf;
};

const makeFadeBuffer = (ctx: BaseAudioContext): AudioBuffer => {
  const len = Math.max(2, Math.round(PC_CYCLE_S * ctx.sampleRate));
  const fadeLen = Math.max(1, Math.round(PC_FADE_S * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    if (i < fadeLen) d[i] = Math.sqrt(i / fadeLen);
    else d[i] = Math.sqrt(Math.max(0, 1 - (i - fadeLen) / (len - fadeLen)));
  }
  return buf;
};

export function createPitchCorrector(ctx: BaseAudioContext): PitchCorrector {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const bypass = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0;
  input.connect(bypass);
  bypass.connect(output);
  wet.connect(output);

  const delay1 = ctx.createDelay(1);
  const delay2 = ctx.createDelay(1);
  const mix1 = ctx.createGain();
  const mix2 = ctx.createGain();
  mix1.gain.value = 0;
  mix2.gain.value = 0;
  input.connect(delay1);
  input.connect(delay2);
  delay1.connect(mix1);
  delay2.connect(mix2);
  mix1.connect(wet);
  mix2.connect(wet);

  // Delay-time modulation: depth gain per tap, fed by either a falling or a rising ramp.
  const depth1 = ctx.createGain();
  const depth2 = ctx.createGain();
  depth1.gain.value = 0;
  depth2.gain.value = 0;
  depth1.connect(delay1.delayTime);
  depth2.connect(delay2.delayTime);

  const downBuf = makeRampBuffer(ctx, true); // delay grows  -> pitch down
  const upBuf = makeRampBuffer(ctx, false); // delay shrinks -> pitch up
  const fadeBuf = makeFadeBuffer(ctx);

  const downGain1 = ctx.createGain();
  const downGain2 = ctx.createGain();
  const upGain1 = ctx.createGain();
  const upGain2 = ctx.createGain();
  downGain1.connect(depth1);
  downGain2.connect(depth2);
  upGain1.connect(depth1);
  upGain2.connect(depth2);

  const sources: AudioBufferSourceNode[] = [];
  const loopSource = (buf: AudioBuffer, dest: AudioNode) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(dest);
    sources.push(s);
    return s;
  };
  const down1 = loopSource(downBuf, downGain1);
  const down2 = loopSource(downBuf, downGain2);
  const up1 = loopSource(upBuf, upGain1);
  const up2 = loopSource(upBuf, upGain2);
  const fade1 = loopSource(fadeBuf, mix1.gain);
  const fade2 = loopSource(fadeBuf, mix2.gain);

  // The ramp sources only start the first time a shift is requested.
  let started = false;
  const ensureStarted = () => {
    if (started) return;
    started = true;
    const t = ctx.currentTime + 0.05;
    const t2 = t + PC_CYCLE_S - PC_FADE_S; // second tap runs half a cycle behind
    down1.start(t);
    up1.start(t);
    fade1.start(t);
    down2.start(t2);
    up2.start(t2);
    fade2.start(t2);
  };

  return {
    input,
    output,
    setSemitones(st: number) {
      const t = ctx.currentTime;
      if (Math.abs(st) < 0.01) {
        bypass.gain.setTargetAtTime(1, t, 0.01);
        wet.gain.setTargetAtTime(0, t, 0.01);
        return;
      }
      ensureStarted();
      const ratio = Math.pow(2, st / 12);
      const up = ratio > 1;
      // Delay slope = |ratio - 1|, so ramp depth = |ratio - 1| * cycle length.
      const depth = Math.abs(ratio - 1) * PC_CYCLE_S;
      upGain1.gain.value = up ? 1 : 0;
      upGain2.gain.value = up ? 1 : 0;
      downGain1.gain.value = up ? 0 : 1;
      downGain2.gain.value = up ? 0 : 1;
      depth1.gain.setTargetAtTime(depth, t, 0.01);
      depth2.gain.setTargetAtTime(depth, t, 0.01);
      bypass.gain.setTargetAtTime(0, t, 0.01);
      wet.gain.setTargetAtTime(1, t, 0.01);
    },
    dispose() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* never started: ignore */
        }
        try {
          s.disconnect();
        } catch {
          /* ignore */
        }
      }
      try {
        input.disconnect();
      } catch {
        /* ignore */
      }
    }
  };
}

// ---- Presets: reverb + EQ ---------------------------------------------------
// Used by AudioPlayer and VideoPlayer. Saved presets and the "Custom" values live in
// one small store (localStorage), so both players show the same list, and Custom
// survives closing the menu, switching presets and restarting the app.

export interface ReverbParams {
  time: number; // seconds until the tail has faded by 60 dB
  damping: number; // 0..1, how fast the highs die away
  preDelay: number; // ms before the reverb starts
}

export const REVERB_TIME_MIN = 0.1;
export const REVERB_TIME_MAX = 8;
export const REVERB_PREDELAY_MAX = 100;

export const REVERB_PRESETS: { id: string; name: string; params: ReverbParams }[] = [
  { id: 'forest', name: 'Forest', params: { time: 1.6, damping: 0.75, preDelay: 35 } },
  { id: 'small-room', name: 'Small Room', params: { time: 0.45, damping: 0.5, preDelay: 4 } },
  { id: 'big-room', name: 'Big Room', params: { time: 1.2, damping: 0.4, preDelay: 14 } },
  { id: 'hall', name: 'Hall', params: { time: 2.5, damping: 0.35, preDelay: 25 } },
  { id: 'cathedral', name: 'Cathedral', params: { time: 5.5, damping: 0.25, preDelay: 40 } }
];
export const REVERB_DEFAULT_ID = 'hall';
export const DEFAULT_REVERB_CUSTOM: ReverbParams = { time: 2, damping: 0.4, preDelay: 20 };

// Small seeded random generator: the same settings always give the same reverb tail.
const makeRng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Builds the reverb tail (impulse response) for a convolver. Noise with an
 *  exponential fade; a low-pass that closes over time makes the highs die first. */
export const buildReverbImpulse = (ctx: BaseAudioContext, p: ReverbParams): AudioBuffer => {
  const sr = ctx.sampleRate;
  const time = Math.max(REVERB_TIME_MIN, p.time);
  const pre = Math.round((p.preDelay / 1000) * sr);
  const tail = Math.max(2, Math.round(time * 1.1 * sr));
  const buf = ctx.createBuffer(2, pre + tail, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rand = makeRng(1234 + ch * 977);
    let lp = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / sr;
      const env = Math.exp((-6.9078 * t) / time);
      const a = Math.min(0.97, p.damping * (0.3 + 0.65 * Math.min(1, t / time)));
      lp = a * lp + (1 - a) * (rand() * 2 - 1);
      d[pre + i] = lp * env;
    }
  }
  return buf;
};

export interface EqValues {
  subBass: number; // dB
  bass: number; // dB
  treble: number; // dB
}

export const EQ_FLAT: EqValues = { subBass: 0, bass: 0, treble: 0 };

export const EQ_PRESETS: { id: string; name: string; values: EqValues }[] = [
  { id: 'flat', name: 'Flat', values: { subBass: 0, bass: 0, treble: 0 } },
  { id: 'bass-boost', name: 'Bass Boost', values: { subBass: 5, bass: 6, treble: 0 } },
  { id: 'deep-bass', name: 'Deep Bass', values: { subBass: 9, bass: 3, treble: -2 } },
  { id: 'warm', name: 'Warm', values: { subBass: 2, bass: 3, treble: -3 } },
  { id: 'bright', name: 'Bright', values: { subBass: -2, bass: -1, treble: 5 } },
  { id: 'treble-boost', name: 'Treble Boost', values: { subBass: 0, bass: 0, treble: 6 } },
  { id: 'vocal', name: 'Vocal', values: { subBass: -6, bass: -2, treble: 3 } },
  { id: 'muffled', name: 'Muffled', values: { subBass: 0, bass: 0, treble: -9 } }
];

export const sameEq = (a: EqValues, b: EqValues) =>
  a.subBass === b.subBass && a.bass === b.bass && a.treble === b.treble;

export interface UserPreset<T> {
  id: string;
  name: string;
  values: T;
}

interface FxPresetState {
  reverbId: string; // a built-in id, a saved id, or 'custom'
  reverbCustom: ReverbParams;
  userReverb: UserPreset<ReverbParams>[];
  eqCustom: EqValues;
  userEq: UserPreset<EqValues>[];
}

const FX_KEY = 'wh3d_fx_presets';

const clampN = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

const normReverb = (r: any, d: ReverbParams): ReverbParams => ({
  time: clampN(r?.time, REVERB_TIME_MIN, REVERB_TIME_MAX, d.time),
  damping: clampN(r?.damping, 0, 1, d.damping),
  preDelay: Math.round(clampN(r?.preDelay, 0, REVERB_PREDELAY_MAX, d.preDelay))
});

const normEq = (r: any): EqValues => ({
  subBass: Math.round(clampN(r?.subBass, -EQ_MAX_DB, EQ_MAX_DB, 0)),
  bass: Math.round(clampN(r?.bass, -EQ_MAX_DB, EQ_MAX_DB, 0)),
  treble: Math.round(clampN(r?.treble, -EQ_MAX_DB, EQ_MAX_DB, 0))
});

const cleanUser = <T,>(list: unknown, norm: (v: any) => T): UserPreset<T>[] =>
  Array.isArray(list)
    ? list
        .filter((u: any) => u && typeof u.id === 'string' && typeof u.name === 'string')
        .map((u: any) => ({ id: u.id, name: u.name.slice(0, 24), values: norm(u.values) }))
    : [];

const loadFx = (): FxPresetState => {
  const base: FxPresetState = {
    reverbId: REVERB_DEFAULT_ID,
    reverbCustom: { ...DEFAULT_REVERB_CUSTOM },
    userReverb: [],
    eqCustom: { ...EQ_FLAT },
    userEq: []
  };
  try {
    const raw = localStorage.getItem(FX_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Record<string, any>;
    const userReverb = cleanUser(p.userReverb, (v) => normReverb(v, DEFAULT_REVERB_CUSTOM));
    const known =
      typeof p.reverbId === 'string' &&
      (p.reverbId === 'custom' ||
        REVERB_PRESETS.some((x) => x.id === p.reverbId) ||
        userReverb.some((u) => u.id === p.reverbId));
    return {
      reverbId: known ? p.reverbId : REVERB_DEFAULT_ID,
      reverbCustom: normReverb(p.reverbCustom, DEFAULT_REVERB_CUSTOM),
      userReverb,
      eqCustom: normEq(p.eqCustom),
      userEq: cleanUser(p.userEq, normEq)
    };
  } catch (e) {
    console.error('Failed to load fx presets from localStorage:', e);
    return base;
  }
};

let fxState: FxPresetState = loadFx();
const fxListeners = new Set<() => void>();

const setFx = (patch: Partial<FxPresetState>) => {
  fxState = { ...fxState, ...patch };
  try {
    localStorage.setItem(FX_KEY, JSON.stringify(fxState));
  } catch (e) {
    console.error('Failed to save fx presets to localStorage:', e);
  }
  fxListeners.forEach((l) => l());
};

const subscribeFx = (l: () => void) => {
  fxListeners.add(l);
  return () => {
    fxListeners.delete(l);
  };
};

/** Re-renders the component whenever a preset, Custom value or saved list changes. */
export const useFxPresets = (): FxPresetState => useSyncExternalStore(subscribeFx, () => fxState);

/** The reverb settings that are active right now (a stable object until they change). */
export const resolveReverbParams = (s: FxPresetState): ReverbParams => {
  if (s.reverbId === 'custom') return s.reverbCustom;
  const b = REVERB_PRESETS.find((p) => p.id === s.reverbId);
  if (b) return b.params;
  const u = s.userReverb.find((p) => p.id === s.reverbId);
  if (u) return u.values;
  return REVERB_PRESETS.find((p) => p.id === REVERB_DEFAULT_ID)!.params;
};

export const useReverbParams = (): ReverbParams => resolveReverbParams(useFxPresets());

export const fxPresetsStore = {
  get: () => fxState,
  reverbParams: () => resolveReverbParams(fxState)
};

const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const cleanName = (n: string) => n.trim().slice(0, 24);

/** Adds (or, for the same name, updates) a saved preset and returns the new list + its id. */
const upsertUser = <T,>(list: UserPreset<T>[], name: string, values: T) => {
  const nm = cleanName(name);
  const ex = list.find((p) => p.name.toLowerCase() === nm.toLowerCase());
  const id = ex ? ex.id : uid();
  const next = ex
    ? list.map((p) => (p.id === id ? { ...p, values } : p))
    : [...list, { id, name: nm, values }];
  return { id, next };
};

export const fxActions = {
  setReverbId: (id: string) => setFx({ reverbId: id }),
  setReverbCustom: (p: ReverbParams) =>
    setFx({ reverbCustom: normReverb(p, DEFAULT_REVERB_CUSTOM) }),
  /** Saves the current Custom reverb under a name and selects it. */
  saveReverbPreset: (name: string) => {
    if (!cleanName(name)) return;
    const { id, next } = upsertUser(fxState.userReverb, name, { ...fxState.reverbCustom });
    setFx({ userReverb: next, reverbId: id });
  },
  deleteReverbPreset: (id: string) =>
    setFx({
      userReverb: fxState.userReverb.filter((p) => p.id !== id),
      reverbId: fxState.reverbId === id ? 'custom' : fxState.reverbId
    }),
  setEqCustom: (v: EqValues) => setFx({ eqCustom: normEq(v) }),
  /** Saves the given EQ values under a name (they then show up as that preset). */
  saveEqPreset: (name: string, values: EqValues) => {
    if (!cleanName(name)) return;
    setFx({ userEq: upsertUser(fxState.userEq, name, normEq(values)).next });
  },
  deleteEqPreset: (id: string) => setFx({ userEq: fxState.userEq.filter((p) => p.id !== id) })
};
