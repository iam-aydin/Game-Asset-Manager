import { useCallback, useEffect, useRef, useState } from 'react';
import { Center, Text } from '@mantine/core';
import {
  IconChevronsLeft,
  IconChevronsRight,
  IconClock,
  IconGauge,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRefresh,
  IconRepeat,
  IconRepeatOff
} from '@tabler/icons-react';
import { SpeakerIcon } from './PlayerIcons';
import { GLASS_CLASS } from './Glasseffect';
import {
  PLAYBACK_INDICATOR,
  hudLimitStyle,
  playbackIndicatorCss,
  type HudLimit
} from '@shared/transition';

// Orange used for "volume boosted above 100%".
export const BOOST_COLOR = '#ff922b';

// Volume icon follows the level: muted, one wave at 50% or below, two waves above.
export function VolumeIcon({ pct, muted, size }: { pct: number; muted: boolean; size: number }) {
  if (muted || pct <= 0) return <SpeakerIcon level="off" size={size} />;
  if (pct <= 50) return <SpeakerIcon level="low" size={size} />;
  return <SpeakerIcon level="high" size={size} />;
}

// Status pill (top of the player): what it shows for each kind of action.
export type HudKind =
  | 'volume'
  | 'speed'
  | 'loop-on'
  | 'loop-off'
  | 'back'
  | 'forward'
  | 'reset'
  | 'seek';

export interface HudState {
  kind: HudKind;
  text: string;
  pct: number; // only used by the volume icon
  boosted: boolean; // volume above 100% -> orange
  visible: boolean;
  limit: HudLimit; // pushing against the top / bottom limit
  level: number; // 0 = first push, grows while the user keeps pushing
  shakeId: number; // flips the shake animation so every push restarts it
}
export type HudInput = Pick<HudState, 'kind' | 'text'> &
  Partial<Pick<HudState, 'pct' | 'boosted' | 'limit' | 'level'>>;

/** State + helpers for the play/pause circle and the status pill. */
export function usePlaybackIndicators() {
  // ---- Play / pause circle (re-keyed on every call so it restarts) ----
  const [indicator, setIndicator] = useState<{ kind: 'play' | 'pause'; id: number } | null>(null);
  const indicatorIdRef = useRef(0);
  const flashIndicator = useCallback(
    (kind: 'play' | 'pause') => setIndicator({ kind, id: ++indicatorIdRef.current }),
    []
  );
  const clearIndicator = useCallback(() => setIndicator(null), []);

  // ---- Status pill ----
  const [hud, setHud] = useState<HudState>({
    kind: 'volume',
    text: '100%',
    pct: 100,
    boosted: false,
    visible: false,
    limit: null,
    level: 0,
    shakeId: 0
  });
  const hudTimerRef = useRef<number | undefined>(undefined);

  const flashHud = useCallback((next: HudInput) => {
    setHud((h) => ({
      pct: 100,
      boosted: false,
      limit: null,
      level: 0,
      ...next,
      shakeId: next.limit === 'max' && (next.level ?? 0) > 0 ? h.shakeId + 1 : h.shakeId,
      visible: true
    }));
    window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(
      () => setHud((h) => ({ ...h, visible: false })),
      PLAYBACK_INDICATOR.hudHoldMs
    );
  }, []);
  useEffect(() => () => window.clearTimeout(hudTimerRef.current), []);

  // Called when the user pushes against a limit that cannot move any further.
  // The first push only refreshes the pill; the reaction starts once they keep
  // pushing back to back, and gets stronger the longer they persist.
  const limitStreakRef = useRef({ key: '', count: 0, at: 0 });
  const hitLimit = useCallback(
    (id: string, edge: 'max' | 'min', pill: HudInput) => {
      const s = limitStreakRef.current;
      const now = performance.now();
      const key = `${id}:${edge}`;
      s.count =
        s.key === key && now - s.at < PLAYBACK_INDICATOR.limitStreakGapMs ? s.count + 1 : 1;
      s.key = key;
      s.at = now;
      const level = Math.min(PLAYBACK_INDICATOR.limitMaxLevel, s.count - 1);
      flashHud({ ...pill, limit: edge, level });
    },
    [flashHud]
  );

  return { indicator, clearIndicator, flashIndicator, hud, flashHud, hitLimit };
}

export type PlaybackIndicatorsApi = ReturnType<typeof usePlaybackIndicators>;

/** Renders the circle + pill. Put it inside any position: relative/absolute box. */
export function PlaybackIndicators({ api }: { api: PlaybackIndicatorsApi }) {
  const { indicator, clearIndicator, hud } = api;

  // Muted / 0% shows only the (crossed-out speaker) icon in the pill, no text.
  const hudIconOnly = hud.kind === 'volume' && hud.pct === 0;
  const hudIconSize = hudIconOnly ? 20 : 16;

  const hudIcon = (() => {
    switch (hud.kind) {
      case 'volume':
        return <VolumeIcon pct={hud.pct} muted={hud.pct === 0} size={hudIconSize} />;
      case 'speed':
        return <IconGauge size={16} />;
      case 'loop-on':
        return <IconRepeat size={16} />;
      case 'loop-off':
        return <IconRepeatOff size={16} />;
      case 'back':
        return <IconChevronsLeft size={16} />;
      case 'forward':
        return <IconChevronsRight size={16} />;
      case 'reset':
        return <IconRefresh size={16} />;
      case 'seek':
        return <IconClock size={16} />;
    }
  })();

  return (
    <>
      <style>{playbackIndicatorCss()}</style>

      {/* Play / pause circle (pops in, holds, shrinks away) */}
      {indicator && (
        <Center style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
          <div
            key={indicator.id}
            className={`${GLASS_CLASS} ${PLAYBACK_INDICATOR.className}`}
            onAnimationEnd={clearIndicator}
          >
            {indicator.kind === 'play' ? (
              <IconPlayerPlayFilled size={PLAYBACK_INDICATOR.iconPx} style={{ marginLeft: 3 }} />
            ) : (
              <IconPlayerPauseFilled size={PLAYBACK_INDICATOR.iconPx} />
            )}
          </div>
        </Center>
      )}

      {/* Status pill: volume / speed / loop / seek / reset.
          At a limit (200% / 0%, 4x / 0.25x) it grows + shakes or shrinks. */}
      <div
        className={`${GLASS_CLASS} ${PLAYBACK_INDICATOR.hudClassName}`}
        data-visible={hud.visible}
        data-shake={hud.shakeId === 0 ? undefined : hud.shakeId % 2 ? 'a' : 'b'}
        style={{
          ...(hudLimitStyle(hud.limit, hud.level) as React.CSSProperties),
          ...(hudIconOnly ? { padding: '8px 12px' } : null)
        }}
      >
        <span style={{ display: 'flex', color: hud.boosted ? BOOST_COLOR : undefined }}>
          {hudIcon}
        </span>
        {!hudIconOnly && (
          <Text
            size="sm"
            fw={600}
            style={{ fontFamily: 'monospace', color: hud.boosted ? BOOST_COLOR : undefined }}
          >
            {hud.text}
          </Text>
        )}
      </div>
    </>
  );
}