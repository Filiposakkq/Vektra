/**
 * Shared palette for the in-page panels and the eval bar, matching the
 * settings window (src/popup/popup.css): warm charcoal to sit with
 * chess.com's dark UI, with the board's best-move blue as the accent.
 */
export const THEME = {
  /** Panel background. */
  oxblood: '#262421',
  /** Raised surfaces: buttons, cards, and the graph frame. */
  claret: '#2f2c29',
  /** Borders and separators. */
  line: '#45403b',
  /** Hairlines between rows. */
  hairline: 'rgba(255, 245, 235, 0.07)',
  /** Deep surface used behind graphs and the eval bar. */
  ink: '#1e1c1a',
  /** Primary text. */
  bone: '#eeeae5',
  muted: '#aaa39b',
  /** Selected and active things, and the primary button (the best-move blue). */
  brass: '#2f6fe4',
  /** Text on the accent. */
  brassText: '#ffffff',
  /** Links on the panel background: the accent, lightened to be readable. */
  link: '#9dbcff',
} as const;

export const DISPLAY_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const BODY_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
