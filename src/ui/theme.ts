/**
 * Shared palette for the extension popup and in-page panels.
 */
export const THEME = {
  /** Panel background. */
  oxblood: '#111820',
  /** Raised surfaces: buttons, cards, and the graph frame. */
  claret: '#1a2531',
  /** Borders and separators. */
  line: '#2b3948',
  /** Deep surface used behind graphs and the eval bar. */
  ink: '#0b1117',
  /** Primary text. */
  bone: '#e7eef6',
  muted: '#9aaabd',
  /** Selected and active things, and the primary button. */
  brass: '#68dfc2',
} as const;

export const DISPLAY_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const BODY_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * A restrained accent strip under Vektra's headers.
 */
export function boardEdge(height = 6): HTMLDivElement {
  const strip = document.createElement('div');
  strip.setAttribute('aria-hidden', 'true');
  Object.assign(strip.style, {
    height: `${height}px`,
    background: `linear-gradient(90deg, ${THEME.brass}, ${THEME.brass} 34%, transparent 100%)`,
    opacity: '0.8',
  } satisfies Partial<CSSStyleDeclaration>);
  return strip;
}
