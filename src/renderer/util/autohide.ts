import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Compact-mode auto-hide for a player control bar (the logic VideoPlayer has
 * inline: bar shows on mouse movement, hides after `hideMs` of stillness, and
 * stays while the pointer is on the bar or something is busy).
 *
 *  - `shown`   -> feed into data-shown on the bar box
 *  - `poke()`  -> call on any mouse movement over the player
 *  - `rearm()` -> call when a menu closes etc., to restart the countdown
 *  - `onMouseEnter` / `onMouseLeave` -> spread on the bar box
 */
export function useAutoHideBar(opts: {
  compact: boolean;
  hideMs: number;
  /** Wait for the collapse animation before the countdown starts. */
  enterDelayMs: number;
  /** Return true while a menu is open or a slider is being dragged. */
  isBusy: () => boolean;
}) {
  const { compact, hideMs, enterDelayMs } = opts;
  const isBusyRef = useRef(opts.isBusy);
  isBusyRef.current = opts.isBusy;

  const [shown, setShown] = useState(true);
  const hoverRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const arm = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (hoverRef.current || isBusyRef.current()) {
        arm();
        return;
      }
      setShown(false);
    }, hideMs);
  }, [hideMs]);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    setShown(true);
    let startTimer: number | undefined;
    if (compact) startTimer = window.setTimeout(arm, enterDelayMs);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(timerRef.current);
    };
  }, [compact, arm, enterDelayMs]);

  const poke = useCallback(() => {
    if (!compact) return;
    setShown(true);
    arm();
  }, [compact, arm]);

  const rearm = useCallback(() => {
    if (compact) arm();
  }, [compact, arm]);

  const onMouseEnter = useCallback(() => {
    hoverRef.current = true;
  }, []);
  const onMouseLeave = useCallback(() => {
    hoverRef.current = false;
    if (compact) arm();
  }, [compact, arm]);

  return { shown, poke, rearm, onMouseEnter, onMouseLeave };
}
