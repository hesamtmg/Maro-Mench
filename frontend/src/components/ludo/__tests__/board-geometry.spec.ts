import { describe, expect, it } from 'vitest';
import {
  HOME_LANE_CELLS,
  RING_CELLS,
  SAFE_SQUARE_POSITIONS,
  positionToCell,
} from '../board-geometry';

describe('Ludo board geometry', () => {
  it('has exactly 52 ring cells', () => {
    expect(RING_CELLS).toHaveLength(52);
  });

  it('has no duplicate ring cells', () => {
    const unique = new Set(RING_CELLS.map(([r, c]) => `${r},${c}`));
    expect(unique.size).toBe(52);
  });

  it('places each seat entry at the correct engine offset', () => {
    // Matches backend ENTRY_OFFSETS = {0:0, 1:13, 2:26, 3:39}
    expect(RING_CELLS[0]).toEqual([7, 2]); // red
    expect(RING_CELLS[13]).toEqual([2, 9]); // green
    expect(RING_CELLS[26]).toEqual([9, 14]); // yellow
    expect(RING_CELLS[39]).toEqual([14, 7]); // blue
  });

  it('matches the backend SAFE_SQUARES set exactly', () => {
    expect(SAFE_SQUARE_POSITIONS).toEqual(
      new Set([0, 8, 13, 21, 26, 34, 39, 47]),
    );
  });

  it('has 4 home lanes, each with 6 unique cells', () => {
    for (const seat of [0, 1, 2, 3]) {
      const lane = HOME_LANE_CELLS[seat];
      expect(lane).toHaveLength(6);
      const unique = new Set(lane.map(([r, c]) => `${r},${c}`));
      expect(unique.size).toBe(6);
    }
  });

  it('has no overlap between ring cells and any home lane cells', () => {
    const ringSet = new Set(RING_CELLS.map(([r, c]) => `${r},${c}`));
    for (const seat of [0, 1, 2, 3]) {
      for (const [r, c] of HOME_LANE_CELLS[seat]) {
        expect(ringSet.has(`${r},${c}`)).toBe(false);
      }
    }
  });

  it('has no overlap between different seats home lanes', () => {
    const allLaneCells = new Set<string>();
    for (const seat of [0, 1, 2, 3]) {
      for (const [r, c] of HOME_LANE_CELLS[seat]) {
        const key = `${r},${c}`;
        expect(allLaneCells.has(key)).toBe(false);
        allLaneCells.add(key);
      }
    }
  });

  describe('positionToCell', () => {
    it('returns null for a token at home (-1)', () => {
      expect(positionToCell(0, -1)).toBeNull();
    });

    it('returns null for a finished token (58)', () => {
      expect(positionToCell(0, 58)).toBeNull();
    });

    it('returns the correct ring cell for a track position', () => {
      expect(positionToCell(0, 10)).toEqual(RING_CELLS[10]);
    });

    it("returns the correct lane cell for a seat's home-run position", () => {
      expect(positionToCell(0, 52)).toEqual(HOME_LANE_CELLS[0][0]);
      expect(positionToCell(0, 57)).toEqual(HOME_LANE_CELLS[0][5]);
    });

    it('uses the correct seat-specific lane for the same relative position', () => {
      const redCell = positionToCell(0, 54);
      const greenCell = positionToCell(1, 54);
      expect(redCell).not.toEqual(greenCell);
    });
  });
});
