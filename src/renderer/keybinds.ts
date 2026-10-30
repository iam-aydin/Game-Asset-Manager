/**
 * Central keybinding table.
 *
 * WHY e.code AND NOT e.key
 * e.key is the character the key produces in the CURRENT layout (Persian: F -> "ف").
 * e.code is the physical key ("KeyF") and never changes with the language, so
 * bindings keep working without switching to English.
 *
 * HOW TO USE
 *   // in a keydown handler (scope = which viewer/player is listening):
 *   if (handleKey(e, 'video', { 'video.fullscreen': () => toggleFullscreen(), ... })) return;
 *
 * Users can override bindings later (settings screen): setBindings(id, [...]).
 * Overrides are saved in localStorage and merged over the defaults.
 */

export type Scope = 'global' | 'video' | 'audio' | 'preview';

export interface Binding {
  /** KeyboardEvent.code, e.g. 'KeyF', 'Space', 'Digit1', 'BracketLeft'. */
  code: string;
  /** Ctrl (or Cmd on macOS). */
  ctrl?: boolean;
  /** true = Shift must be held, false/undefined = must NOT be held, 'any' = don't care. */
  shift?: boolean | 'any';
  alt?: boolean;
}

export interface ActionDef {
  label: string;
  scope: Scope;
  defaults: Binding[];
}

const k = (code: string, mods: Omit<Binding, 'code'> = {}): Binding => ({ code, ...mods });

export const ACTIONS = {
  // ---- Global (App.tsx) ----------------------------------------------------
  'nav.back': { label: 'Back', scope: 'global', defaults: [k('ArrowLeft', { alt: true }), k('Backspace')] },
  'nav.forward': { label: 'Forward', scope: 'global', defaults: [k('ArrowRight', { alt: true })] },
  'nav.up': { label: 'Up one folder', scope: 'global', defaults: [k('ArrowUp', { alt: true })] },
  'file.prev': { label: 'Previous file', scope: 'global', defaults: [k('ArrowLeft', { shift: 'any' })] },
  'file.next': { label: 'Next file', scope: 'global', defaults: [k('ArrowRight', { shift: 'any' })] },
  'file.delete': { label: 'Delete selection', scope: 'global', defaults: [k('Delete')] },
  'file.duplicate': { label: 'Duplicate selection', scope: 'global', defaults: [k('KeyD', { ctrl: true })] },
  'file.fullscreenPreview': { label: 'Fullscreen preview', scope: 'global', defaults: [k('Space')] },
  'rate.0': { label: 'Rating: none', scope: 'global', defaults: [k('Digit0'), k('Numpad0')] },
  'rate.1': { label: 'Rating: 1', scope: 'global', defaults: [k('Digit1'), k('Numpad1')] },
  'rate.2': { label: 'Rating: 2', scope: 'global', defaults: [k('Digit2'), k('Numpad2')] },
  'rate.3': { label: 'Rating: 3', scope: 'global', defaults: [k('Digit3'), k('Numpad3')] },
  'rate.4': { label: 'Rating: 4', scope: 'global', defaults: [k('Digit4'), k('Numpad4')] },
  'rate.5': { label: 'Rating: 5', scope: 'global', defaults: [k('Digit5'), k('Numpad5')] },
  'label.clear': { label: 'Clear color label', scope: 'global', defaults: [k('Digit0', { ctrl: true })] },
  'label.1': { label: 'Color label 1 (red)', scope: 'global', defaults: [k('Digit1', { ctrl: true })] },
  'label.2': { label: 'Color label 2 (yellow)', scope: 'global', defaults: [k('Digit2', { ctrl: true })] },
  'label.3': { label: 'Color label 3 (green)', scope: 'global', defaults: [k('Digit3', { ctrl: true })] },
  'label.4': { label: 'Color label 4 (blue)', scope: 'global', defaults: [k('Digit4', { ctrl: true })] },
  'label.5': { label: 'Color label 5 (purple)', scope: 'global', defaults: [k('Digit5', { ctrl: true })] },

  // ---- Video player --------------------------------------------------------
  'video.playPause': { label: 'Play / pause', scope: 'video', defaults: [k('Space'), k('KeyS')] },
  'video.seekBack': { label: 'Seek back', scope: 'video', defaults: [k('KeyA')] },
  'video.seekForward': { label: 'Seek forward', scope: 'video', defaults: [k('KeyD')] },
  'video.volumeUp': { label: 'Volume up', scope: 'video', defaults: [k('KeyW')] },
  'video.volumeDown': { label: 'Volume down', scope: 'video', defaults: [k('KeyX')] },
  'video.mute': { label: 'Mute', scope: 'video', defaults: [k('KeyM')] },
  'video.speedDown': { label: 'Slower', scope: 'video', defaults: [k('KeyJ')] },
  'video.speedUp': { label: 'Faster', scope: 'video', defaults: [k('KeyL')] },
  'video.speedReset': { label: 'Normal speed', scope: 'video', defaults: [k('KeyK')] },
  'video.fullscreen': { label: 'Fullscreen', scope: 'video', defaults: [k('KeyF')] },
  'video.reset': { label: 'Reset settings', scope: 'video', defaults: [k('KeyR')] },
  'video.hideInterface': { label: 'Hide interface', scope: 'video', defaults: [k('KeyO')] },
  'video.contextMenu': { label: 'Open context menu', scope: 'video', defaults: [k('KeyQ')] },
  'video.volumeMenu': { label: 'Open volume menu', scope: 'video', defaults: [k('KeyS', { alt: true })] },
  'video.zoomIn': { label: 'Zoom in', scope: 'video', defaults: [k('Equal', { shift: 'any' }), k('NumpadAdd')] },
  'video.zoomOut': { label: 'Zoom out', scope: 'video', defaults: [k('Minus', { shift: 'any' }), k('NumpadSubtract')] },
  'video.stretchVPlus': { label: 'Stretch vertically', scope: 'video', defaults: [k('BracketLeft')] },
  'video.stretchVMinus': { label: 'Shrink vertically', scope: 'video', defaults: [k('BracketLeft', { shift: true })] },
  'video.stretchHPlus': { label: 'Stretch horizontally', scope: 'video', defaults: [k('BracketRight')] },
  'video.stretchHMinus': { label: 'Shrink horizontally', scope: 'video', defaults: [k('BracketRight', { shift: true })] },
  'video.panUp': { label: 'Move picture up', scope: 'video', defaults: [k('KeyW', { shift: true })] },
  'video.panDown': { label: 'Move picture down', scope: 'video', defaults: [k('KeyS', { shift: true })] },
  'video.panLeft': { label: 'Move picture left', scope: 'video', defaults: [k('KeyA', { shift: true })] },
  'video.panRight': { label: 'Move picture right', scope: 'video', defaults: [k('KeyD', { shift: true })] }
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;

// ---- Overrides (user customisation) ------------------------------------------

const STORAGE_KEY = 'gam:keybinds';

function loadOverrides(): Partial<Record<ActionId, Binding[]>> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

let overrides = loadOverrides();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

/** Subscribe to binding changes (for a settings UI or tooltips). Returns unsubscribe. */
export function subscribeKeybinds(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getBindings(id: ActionId): readonly Binding[] {
  return overrides[id] ?? ACTIONS[id].defaults;
}

export function setBindings(id: ActionId, bindings: Binding[]): void {
  overrides = { ...overrides, [id]: bindings };
  persist();
}

export function resetBindings(id?: ActionId): void {
  if (id) {
    const { [id]: _drop, ...rest } = overrides;
    overrides = rest;
  } else {
    overrides = {};
  }
  persist();
}

// ---- Matching ----------------------------------------------------------------

export function matchesBinding(e: KeyboardEvent, b: Binding): boolean {
  if (e.code !== b.code) return false;
  if (!!b.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (!!b.alt !== e.altKey) return false;
  if (b.shift !== 'any' && !!b.shift !== e.shiftKey) return false;
  return true;
}

export function matchesAction(e: KeyboardEvent, id: ActionId): boolean {
  return getBindings(id).some((b) => matchesBinding(e, b));
}

/** Which action (in this scope or 'global') does this event trigger? */
export function actionFor(e: KeyboardEvent, scope: Scope): ActionId | null {
  for (const id of Object.keys(ACTIONS) as ActionId[]) {
    const s = ACTIONS[id].scope;
    if (s !== scope) continue;
    if (matchesAction(e, id)) return id;
  }
  return null;
}

/**
 * One-liner for keydown handlers. Runs the matching handler (if any), calls
 * preventDefault, and returns true so the caller can `return`.
 */
export function handleKey(
  e: KeyboardEvent,
  scope: Scope,
  handlers: Partial<Record<ActionId, (e: KeyboardEvent) => void>>
): boolean {
  const id = actionFor(e, scope);
  if (!id) return false;
  const fn = handlers[id];
  if (!fn) return false;
  e.preventDefault();
  fn(e);
  return true;
}

// ---- Settings-UI helpers -------------------------------------------------------

/** Turn a keydown event into a Binding (for a "press the new key" capture box). */
export function bindingFromEvent(e: KeyboardEvent): Binding | null {
  if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
    return null; // modifier alone
  }
  return { code: e.code, ctrl: e.ctrlKey || e.metaKey || undefined, shift: e.shiftKey || undefined, alt: e.altKey || undefined };
}

/** Other actions in the same scope already using this binding (for conflict warnings). */
export function findConflicts(id: ActionId, b: Binding): ActionId[] {
  const scope = ACTIONS[id].scope;
  return (Object.keys(ACTIONS) as ActionId[]).filter(
    (other) =>
      other !== id &&
      ACTIONS[other].scope === scope &&
      getBindings(other).some(
        (x) => x.code === b.code && !!x.ctrl === !!b.ctrl && !!x.alt === !!b.alt && x.shift === b.shift
      )
  );
}

const CODE_LABELS: Record<string, string> = {
  Space: 'Space', Equal: '+', Minus: '-', BracketLeft: '[', BracketRight: ']',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -'
};

/** "KeyF" -> "F", plus modifiers: "Ctrl+Shift+F". Use in tooltips and settings. */
export function formatBinding(b: Binding): string {
  const base =
    CODE_LABELS[b.code] ??
    (b.code.startsWith('Key') ? b.code.slice(3) : b.code.startsWith('Digit') ? b.code.slice(5) : b.code);
  return [b.ctrl && 'Ctrl', b.alt && 'Alt', b.shift === true && 'Shift', base].filter(Boolean).join('+');
}

export function formatAction(id: ActionId): string {
  return getBindings(id).map(formatBinding).join(' / ');
}