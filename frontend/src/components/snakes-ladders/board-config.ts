// Mirrors backend/src/modules/game-engine/snakes-ladders/board-config.ts.
// The authoritative snakes/ladders for a live game always come from the
// server via boardState (a room could use a custom board), but we keep
// this default copy for tests and as a sensible fallback if boardState
// hasn't arrived yet.

export const DEFAULT_SNAKES: Record<number, number> = {
  16: 6,
  47: 26,
  49: 11,
  56: 53,
  62: 19,
  64: 60,
  87: 24,
  93: 73,
  95: 75,
  98: 78,
};

export const DEFAULT_LADDERS: Record<number, number> = {
  1: 38,
  4: 14,
  9: 31,
  21: 42,
  28: 84,
  36: 44,
  51: 67,
  71: 91,
  80: 100,
};
