import { describe, expect, it } from 'vitest';
import {
  squareToCenterPercent,
  squareToGridPosition,
} from '../board-geometry';
import { DEFAULT_LADDERS, DEFAULT_SNAKES } from '../board-config';

describe('Snakes & Ladders board geometry', () => {
  it('places square 1 at the bottom-left', () => {
    expect(squareToGridPosition(1)).toEqual({ row: 9, col: 0 });
  });

  it('places square 10 at the bottom-right', () => {
    expect(squareToGridPosition(10)).toEqual({ row: 9, col: 9 });
  });

  it('places square 11 directly above square 10 (boustrophedon turn)', () => {
    const ten = squareToGridPosition(10);
    const eleven = squareToGridPosition(11);
    expect(eleven.row).toBe(ten.row - 1);
    expect(eleven.col).toBe(ten.col);
  });

  it('places square 20 at the left edge, one row above square 1', () => {
    expect(squareToGridPosition(20)).toEqual({ row: 8, col: 0 });
  });

  it('places square 100 at the top-left', () => {
    expect(squareToGridPosition(100)).toEqual({ row: 0, col: 0 });
  });

  it('places square 91 at the top-right', () => {
    expect(squareToGridPosition(91)).toEqual({ row: 0, col: 9 });
  });

  it('assigns every square 1-100 a unique grid position', () => {
    const positions = new Set<string>();
    for (let sq = 1; sq <= 100; sq++) {
      const { row, col } = squareToGridPosition(sq);
      positions.add(`${row},${col}`);
    }
    expect(positions.size).toBe(100);
  });

  it('throws for an invalid square number', () => {
    expect(() => squareToGridPosition(0)).toThrow();
    expect(() => squareToGridPosition(101)).toThrow();
  });

  describe('squareToCenterPercent', () => {
    it('returns values within the 0-100 percent range', () => {
      for (const sq of [1, 50, 100]) {
        const { xPercent, yPercent } = squareToCenterPercent(sq);
        expect(xPercent).toBeGreaterThan(0);
        expect(xPercent).toBeLessThan(100);
        expect(yPercent).toBeGreaterThan(0);
        expect(yPercent).toBeLessThan(100);
      }
    });

    it('centers square 1 in the bottom-left cell', () => {
      const { xPercent, yPercent } = squareToCenterPercent(1);
      expect(xPercent).toBeCloseTo(5, 5); // half of one 10%-wide cell
      expect(yPercent).toBeCloseTo(95, 5);
    });
  });

  describe('consistency with backend snake/ladder data', () => {
    it('every snake head has a higher square number than its tail', () => {
      for (const [head, tail] of Object.entries(DEFAULT_SNAKES)) {
        expect(Number(head)).toBeGreaterThan(tail);
      }
    });

    it('every ladder bottom has a lower square number than its top', () => {
      for (const [bottom, top] of Object.entries(DEFAULT_LADDERS)) {
        expect(Number(bottom)).toBeLessThan(top);
      }
    });

    it('no square is used as more than one snake/ladder start', () => {
      const starts = [
        ...Object.keys(DEFAULT_SNAKES),
        ...Object.keys(DEFAULT_LADDERS),
      ];
      expect(new Set(starts).size).toBe(starts.length);
    });
  });
});
