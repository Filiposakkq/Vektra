import { describeMoveAnalysis, type MoveAnalysis } from '../analysis/gameAnalysis';
import { categoryBadge } from './categoryStyle';

const BADGE_CLASS = 'vektra-move-badge';

/**
 * Put a classification badge on each main-line move in chess.com's move list,
 * given the list's main-line move elements in order. Safe to call repeatedly;
 * chess.com re-renders the list, so callers re-apply after changes.
 */
export function applyMoveBadges(plies: readonly Element[], moves: readonly (MoveAnalysis | undefined)[]): void {
  plies.forEach((node, i) => {
    const move = moves[i];
    const existing = node.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
    if (!move) {
      existing?.remove();
      return;
    }
    let badge = existing;
    if (badge && badge.dataset.category !== move.category) {
      badge.remove();
      badge = null;
    }
    badge ??= categoryBadge(move.category, 15);
    badge.classList.add(BADGE_CLASS);
    badge.dataset.category = move.category;
    badge.dataset.ply = String(move.ply);
    badge.title = describeMoveAnalysis(move);
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', badge.title);
    badge.style.marginRight = '3px';
    badge.style.verticalAlign = 'middle';
    if (!badge.parentElement) node.insertBefore(badge, node.firstChild);
  });
}

export function clearMoveBadges(root: ParentNode = document): void {
  for (const el of root.querySelectorAll(`.${BADGE_CLASS}`)) el.remove();
}
