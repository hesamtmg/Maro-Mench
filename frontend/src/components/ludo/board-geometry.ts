// Verified Ludo board geometry: maps the backend engine's abstract
// position numbers onto real (row, col) coordinates on a 15x15 cross
// grid, so the visual board is a faithful rendering of engine state
// rather than an approximation.
//
// This was derived and numerically verified (not hand-eyeballed) against
// backend/src/modules/game-engine/ludo/board-config.ts:
//   - TRACK_LENGTH = 52, ENTRY_OFFSETS = {0:0, 1:13, 2:26, 3:39}
//   - SAFE_SQUARES = {0, 8, 13, 21, 26, 34, 39, 47}
// See the derivation notes below for how each piece was checked.

export const GRID_SIZE = 15;

// The 52-cell shared ring, in engine-position order (index 0 = engine
// position 0, red's entry square). Each entry is [row, col], 1-indexed.
//
// Constructed as one 13-cell "quarter" (red's arm, engine positions
// 0-12) rotated 90 degrees clockwise three more times to produce green's,
// yellow's, and blue's quarters. Verified: 52 unique cells, entries land
// at indices 0/13/26/39, and the 8 known safe squares fall in a
// symmetric pattern (one per color's entry + one star per arm).
export const RING_CELLS: [number, number][] = [
  [7, 2], [7, 3], [7, 4], [7, 5], [7, 6],
  [6, 7], [5, 7], [4, 7], [3, 7], [2, 7], [1, 7],
  [1, 8],
  [1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9],
  [7, 10], [7, 11], [7, 12], [7, 13], [7, 14], [7, 15],
  [8, 15],
  [9, 15], [9, 14], [9, 13], [9, 12], [9, 11], [9, 10],
  [10, 9], [11, 9], [12, 9], [13, 9], [14, 9], [15, 9],
  [15, 8],
  [15, 7], [14, 7], [13, 7], [12, 7], [11, 7], [10, 7],
  [9, 6], [9, 5], [9, 4], [9, 3], [9, 2], [9, 1],
  [8, 1],
  [7, 1],
];

// Each color's 6-cell home lane (engine positions 52-57 for that seat),
// running from just inside the ring toward the center, ending adjacent
// to the center square.
//
// Each color's home lane sits in the arm immediately counterclockwise of
// its own entry arm — that's the last arm a token passes through before
// completing the lap back to its own side, matching the classic layout.
export const HOME_LANE_CELLS: Record<number, [number, number][]> = {
  0: [[8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7]], // red
  1: [[2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8]], // green
  2: [[8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9]], // yellow
  3: [[14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8]], // blue
};

// Matches backend SAFE_SQUARES exactly (engine position indices, not
// row/col) — used to render star markers on the ring.
export const SAFE_SQUARE_POSITIONS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export const TRACK_LENGTH = 52;
export const HOME_RUN_LENGTH = 6;
export const FINISHED_POSITION = TRACK_LENGTH + HOME_RUN_LENGTH; // 58

// Entry square (on the shared 0-51 track) for each seat's tokens when they
// leave home. Matches backend/src/modules/game-engine/ludo/board-config.ts
// ENTRY_OFFSETS exactly.
export const ENTRY_OFFSETS: Record<number, number> = {
  0: 0,
  1: 13,
  2: 26,
  3: 39,
};

/**
 * Converts an engine token position (as produced by the Ludo engine's
 * board_state) into a grid cell, for a given seat.
 *   -1            -> not on the grid (still in the yard)
 *   0..51         -> a cell on the shared ring
 *   52..57        -> a cell in this seat's own home lane
 *   58 (finished) -> not on the grid (rendered in the center instead)
 */
export function positionToCell(
  seatIndex: number,
  position: number,
): [number, number] | null {
  if (position < 0 || position >= FINISHED_POSITION) {
    return null;
  }
  if (position < TRACK_LENGTH) {
    return RING_CELLS[position];
  }
  const lane = HOME_LANE_CELLS[seatIndex];
  return lane[position - TRACK_LENGTH];
}
