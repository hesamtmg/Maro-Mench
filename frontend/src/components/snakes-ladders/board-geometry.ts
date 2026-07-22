// Verified Snakes & Ladders board geometry: maps square numbers (1-100)
// to grid positions and pixel-center percentages, so an SVG overlay can
// draw snakes/ladders as real connecting lines between their exact
// head/tail squares rather than just tinting the start/end cells.
//
// The grid ordering matches the classic boustrophedon layout: the top
// row of the visual board is squares 91-100, the bottom row is 1-10,
// alternating direction row by row. This was verified against the
// backend's DEFAULT_SNAKES / DEFAULT_LADDERS: every snake head has a
// higher square number than its tail, every ladder bottom has a lower
// number than its top, confirming the direction convention.

export const BOARD_SIZE = 100;
export const COLS = 10;
export const ROWS = 10;

// Ordered list where index i = (row, col) in a top-to-bottom,
// left-to-right reading order, and the value is the square number
// rendered there. Row 0 is the TOP of the visual board (squares 91-100).
const GRID_ORDER: number[] = (() => {
  const order: number[] = [];
  for (let row = 0; row < ROWS; row++) {
    const rowStart = BOARD_SIZE - row * COLS;
    const rowNumbers = Array.from({ length: COLS }, (_, i) => rowStart - i);
    if (row % 2 === 1) rowNumbers.reverse();
    order.push(...rowNumbers);
  }
  return order;
})();

// square (1-100) -> { row, col }, 0-indexed grid position.
const SQUARE_TO_GRID = new Map<number, { row: number; col: number }>();
GRID_ORDER.forEach((square, index) => {
  SQUARE_TO_GRID.set(square, {
    row: Math.floor(index / COLS),
    col: index % COLS,
  });
});

export function squareToGridPosition(square: number): {
  row: number;
  col: number;
} {
  const pos = SQUARE_TO_GRID.get(square);
  if (!pos) {
    throw new Error(`Invalid square number: ${square}`);
  }
  return pos;
}

/**
 * Returns the center of a square as a percentage (0-100) of the board's
 * width/height, suitable for positioning an SVG element with
 * viewBox="0 0 100 100" so it scales with the board regardless of its
 * rendered pixel size.
 */
export function squareToCenterPercent(square: number): {
  xPercent: number;
  yPercent: number;
} {
  const { row, col } = squareToGridPosition(square);
  const cellSize = 100 / COLS;
  return {
    xPercent: col * cellSize + cellSize / 2,
    yPercent: row * cellSize + cellSize / 2,
  };
}
