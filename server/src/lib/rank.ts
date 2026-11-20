export const RANK_STEP = 1024;
export const MIN_GAP = 1e-6;

/**
 * Fractional ranking for drag-and-drop ordering. Returns a rank between
 * `before` (the card that will sit above) and `after` (the card below).
 * Returns null when the gap is too small and the column must be rebalanced.
 */
export function rankBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) return (after as number) - RANK_STEP;
  if (after === null) return before + RANK_STEP;
  if (after - before < MIN_GAP) return null;
  return (before + after) / 2;
}
