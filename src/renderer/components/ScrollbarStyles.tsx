/**
 * App-wide scrollbar look: the same thin, rounded, see-through bar the Mantine
 * ScrollArea cards use (e.g. the license box in the metadata panel), applied to
 * every plain scrolling area too (the file grid, the side panels, text boxes).
 *
 * Replaces the chunky Windows bar and its arrow buttons. Colors come from the
 * theme text color, so it follows every theme and light / dark mode.
 *
 * Mantine's own ScrollArea hides the native bar and draws its own, so it is
 * left alone (see the last rule).
 */
export const SCROLLBAR_CSS = `
*::-webkit-scrollbar {
  width: 12px;
  height: 12px;
  background: transparent;
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}
/* No up / down arrow buttons */
*::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
/* A 12px bar with a 3px see-through border leaves a 6px rounded thumb. */
*::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--mantine-color-text) 26%, transparent);
  border: 3px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
  min-height: 40px;
  min-width: 40px;
}
*::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--mantine-color-text) 48%, transparent);
}
*::-webkit-scrollbar-thumb:active {
  background-color: color-mix(in srgb, var(--mantine-color-text) 64%, transparent);
}
.mantine-ScrollArea-viewport::-webkit-scrollbar {
  display: none;
}
`;

export function ScrollbarStyles() {
  return <style>{SCROLLBAR_CSS}</style>;
}
