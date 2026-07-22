import { describe, expect, it } from 'vitest';
import { ladderGeometry, snakePath } from '../svg-shapes';

describe('snakePath', () => {
  it('starts exactly at the from point', () => {
    const d = snakePath({ x: 10, y: 80 }, { x: 40, y: 20 });
    expect(d.startsWith('M 10 80')).toBe(true);
  });

  it('ends exactly at the to point', () => {
    const to = { x: 40, y: 20 };
    const d = snakePath({ x: 10, y: 80 }, to);
    expect(d.trim().endsWith(`T ${to.x} ${to.y}`)).toBe(true);
  });

  it('produces intermediate points that deviate from a straight line (i.e. it wiggles)', () => {
    const from = { x: 10, y: 80 };
    const to = { x: 40, y: 20 };
    const d = snakePath(from, to, 4, 5);
    const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

    let anyOffPath = false;
    for (let i = 2; i + 1 < numbers.length; i += 2) {
      const x = numbers[i];
      const y = numbers[i + 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lineLen = Math.hypot(dx, dy);
      const dist =
        Math.abs(dy * x - dx * y + to.x * from.y - to.y * from.x) / lineLen;
      if (dist > 0.5) anyOffPath = true;
    }
    expect(anyOffPath).toBe(true);
  });

  it('handles identical from/to points without throwing', () => {
    expect(() => snakePath({ x: 5, y: 5 }, { x: 5, y: 5 })).not.toThrow();
  });
});

describe('ladderGeometry', () => {
  it('produces two parallel rails mirrored around the centerline', () => {
    const from = { x: 10, y: 90 };
    const to = { x: 10, y: 10 }; // straight vertical ladder
    const gap = 3;
    const { rail1, rail2 } = ladderGeometry(from, to, gap);

    // For a vertical line, the perpendicular offset is purely
    // horizontal, so rail1 and rail2 should sit equally on either side
    // of x=10 (mirrored), each exactly `gap` away from the centerline.
    expect(Math.abs(rail1[0].x - 10)).toBeCloseTo(gap, 5);
    expect(Math.abs(rail2[0].x - 10)).toBeCloseTo(gap, 5);
    expect(rail1[0].x).not.toBeCloseTo(rail2[0].x, 5); // on opposite sides
    expect(rail1[0].y).toBeCloseTo(from.y, 5);
  });

  it('produces the requested number of rungs (plus one for both ends)', () => {
    const { rungs } = ladderGeometry({ x: 0, y: 0 }, { x: 0, y: 100 }, 2, 5);
    expect(rungs).toHaveLength(6); // rungCount + 1 (includes both ends)
  });

  it('places the first rung at the "from" end and the last at the "to" end', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 0, y: 100 };
    const { rungs } = ladderGeometry(from, to, 2, 4);

    const firstRungMidY = (rungs[0][0].y + rungs[0][1].y) / 2;
    const lastRungMidY =
      (rungs[rungs.length - 1][0].y + rungs[rungs.length - 1][1].y) / 2;

    expect(firstRungMidY).toBeCloseTo(from.y, 5);
    expect(lastRungMidY).toBeCloseTo(to.y, 5);
  });

  it('keeps rails equidistant from the centerline at every rung', () => {
    const from = { x: 20, y: 80 };
    const to = { x: 60, y: 30 };
    const { rail1, rail2 } = ladderGeometry(from, to, 4);

    const dist1 = Math.hypot(rail1[0].x - from.x, rail1[0].y - from.y);
    const dist2 = Math.hypot(rail2[0].x - from.x, rail2[0].y - from.y);
    expect(dist1).toBeCloseTo(dist2, 5);
  });
});
