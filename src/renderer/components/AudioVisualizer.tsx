import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';

/**
 * Tiny shared store. AudioPlayer publishes its AnalyserNode and play state here,
 * and any <AudioVisualizer /> on screen (the big preview area, the player bar, ...)
 * subscribes to it. No props need to be passed between the parent and the player.
 */
interface VizState {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

let vizState: VizState = { analyser: null, isPlaying: false };
const listeners = new Set<() => void>();

export const audioVizStore = {
  get: (): VizState => vizState,
  set(partial: Partial<VizState>) {
    const next = { ...vizState, ...partial };
    if (next.analyser === vizState.analyser && next.isPlaying === vizState.isPlaying) return;
    vizState = next;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};

const VIZ_MIN_HZ = 30;
const VIZ_MAX_HZ = 16000;

interface AudioVisualizerProps {
  /** Number of bars. Use more for a wide/hero visualizer, fewer for a small one. */
  bars?: number;
  /** Height of the visualizer. Defaults to filling its parent. */
  height?: number | string;
  style?: CSSProperties;
}

export function AudioVisualizer({ bars = 56, height = '100%', style }: AudioVisualizerProps) {
  const { analyser, isPlaying } = useSyncExternalStore(audioVizStore.subscribe, audioVizStore.get);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef(new Float32Array(bars));
  const dataRef = useRef(new Uint8Array(2048));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (barsRef.current.length !== bars) {
      barsRef.current = new Float32Array(bars);
    }

    // Draws one frame. Returns true while it still needs to keep animating.
    const draw = (): boolean => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (w === 0 || h === 0) return false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const c = canvas.getContext('2d');
      if (!c) return false;

      const values = barsRef.current;
      const live = isPlaying && !!analyser;

      let binHz = 1;
      if (live && analyser) {
        if (dataRef.current.length !== analyser.frequencyBinCount) {
          dataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(dataRef.current);
        binHz = analyser.context.sampleRate / analyser.fftSize;
      }
      const data = dataRef.current;
      const ratio = VIZ_MAX_HZ / VIZ_MIN_HZ;

      let animating = live;
      for (let i = 0; i < bars; i++) {
        let target = 0;
        if (live) {
          // Bars are spaced logarithmically so bass gets as much room as treble
          const f0 = VIZ_MIN_HZ * Math.pow(ratio, i / bars);
          const f1 = VIZ_MIN_HZ * Math.pow(ratio, (i + 1) / bars);
          const b0 = Math.floor(f0 / binHz);
          const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
          let sum = 0;
          let count = 0;
          for (let b = b0; b < b1 && b < data.length; b++) {
            sum += data[b];
            count++;
          }
          const raw = count ? sum / count / 255 : 0;
          target = Math.min(1, raw * (1 + (i / bars) * 0.8)); // slight tilt so highs stay visible
        }
        // Instant attack, smooth fall
        values[i] = Math.max(target, values[i] * 0.88);
        if (values[i] < 0.004) values[i] = 0;
        if (values[i] > 0) animating = true;
      }

      c.clearRect(0, 0, w, h);
      const gap = Math.max(2, Math.round(3 * dpr));
      const barW = (w - gap * (bars - 1)) / bars;
      const mid = h / 2;
      const maxHalf = mid - 2 * dpr;

      const grad = c.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#a5b4fc');
      grad.addColorStop(0.5, '#7c83f5');
      grad.addColorStop(1, '#a5b4fc');
      c.fillStyle = grad;

      for (let i = 0; i < bars; i++) {
        const half = Math.max(dpr, values[i] * maxHalf);
        const x = i * (barW + gap);
        const y = mid - half;
        if (typeof c.roundRect === 'function') {
          c.beginPath();
          c.roundRect(x, y, barW, half * 2, Math.min(barW / 2, half));
          c.fill();
        } else {
          c.fillRect(x, y, barW, half * 2);
        }
      }

      return animating;
    };

    let frame: number | null = null;
    const loop = () => {
      frame = draw() ? requestAnimationFrame(loop) : null;
    };
    frame = requestAnimationFrame(loop);

    // Redraw the idle state when resized
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (frame === null) draw();
      });
      ro.observe(canvas);
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [analyser, isPlaying, bars]);

  return (
    <div style={{ width: '100%', height, ...style }}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}