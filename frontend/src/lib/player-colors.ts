// Ludo seats are stored server-side as plain CSS colour names ('red',
// 'green', ...). Those render as harsh pure primaries, so map them onto
// the board's richer palette wherever a player colour is painted.
const NAMED_TO_PALETTE: Record<string, string> = {
  red: '#e33e3e',
  green: '#3aa15c',
  yellow: '#e8b93e',
  blue: '#3f6fd1',
};

export function prettyColor(color: string | null | undefined, fallback = '#9333ea'): string {
  if (!color) return fallback;
  return NAMED_TO_PALETTE[color.toLowerCase()] ?? color;
}
