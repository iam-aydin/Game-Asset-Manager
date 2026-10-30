import { useCallback, useEffect, useState } from 'react';

// Audio output device shared by the video and audio players (saved between launches).
const KEY = 'gam_audio_output_device';

export interface OutputDevice {
  id: string;
  label: string;
}

let currentId = 'default';
try {
  currentId = localStorage.getItem(KEY) || 'default';
} catch {
  /* ignore */
}
const listeners = new Set<() => void>();

export const outputStore = {
  get: () => currentId,
  set(id: string) {
    currentId = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }
};

/** Points AudioContexts / media elements at the chosen device ("default" = system default). */
export async function applyOutput(id: string, targets: unknown[]): Promise<void> {
  const sink = id === 'default' ? '' : id;
  for (const t of targets) {
    const fn = (t as { setSinkId?: (id: string) => Promise<void> } | null)?.setSinkId;
    if (typeof fn !== 'function') continue;
    try {
      await fn.call(t, sink);
    } catch {
      // Device unplugged or refused: fall back to the system default.
      try {
        await fn.call(t, '');
      } catch {
        /* ignore */
      }
    }
  }
}

let labelsAsked = false;

async function listOutputs(): Promise<OutputDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  let outs = (await md.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  // Chromium hides device names until the page has had microphone permission once.
  // Ask a single time, stop the stream right away, and read the names again.
  if (outs.length > 0 && outs.some((d) => !d.label) && !labelsAsked) {
    labelsAsked = true;
    try {
      const s = await md.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      outs = (await md.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    } catch {
      /* no mic / denied: keep generic names */
    }
  }
  return outs
    .filter((d) => d.deviceId !== 'communications')
    .map((d, i) => ({
      id: d.deviceId,
      label: d.label || (d.deviceId === 'default' ? 'System default' : `Output ${i + 1}`)
    }));
}

export function useAudioOutput() {
  const [deviceId, setId] = useState(outputStore.get());
  const [devices, setDevices] = useState<OutputDevice[]>([]);

  useEffect(() => {
    const l = () => setId(outputStore.get());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setDevices(await listOutputs());
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  return { deviceId, devices, setDeviceId: outputStore.set, refresh };
}