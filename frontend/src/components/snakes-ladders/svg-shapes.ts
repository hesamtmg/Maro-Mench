// Pure geometry helpers for drawing snakes and ladders as an SVG overlay
// on top of the board grid. Coordinates are all in a 0-100 percent
// space (matching an SVG viewBox="0 0 100 100"), so the overlay scales
// with the board regardless of its rendered pixel size.

export interface Point {
  x: number;
  y: number;
}

/**
 * Generates a wiggly SVG path "d" attribute between two points, used to
 * draw a snake's body as an organic curve rather than a straight line.
 * The wiggle alternates side-to-side and tapers to zero at both ends so
 * the curve starts and ends exactly on the head/tail squares.
 */
export function snakePath(
  from: Point,
  to: Point,
  segments = 5,
  amplitude = 3,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return `M ${from.x} ${from.y}`;

  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular unit vector, used to offset points side-to-side.
  const px = -uy;
  const py = ux;

  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const baseX = from.x + dx * t;
    const baseY = from.y + dy * t;
    const side = i % 2 === 0 ? 1 : -1;
    const taper = Math.sin(Math.PI * t); // 0 at both ends, 1 at middle
    const offset = side * amplitude * taper;
    points.push({ x: baseX + px * offset, y: baseY + py * offset });
  }

  let d = `M ${points[0].x} ${points[0].y} `;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    d += `Q ${prev.x} ${prev.y} ${midX} ${midY} `;
  }
  const last = points[points.length - 1];
  d += `T ${last.x} ${last.y}`;
  return d;
}

export interface LadderGeometry {
  rail1: [Point, Point];
  rail2: [Point, Point];
  rungs: [Point, Point][];
}

/**
 * Computes the two parallel side-rails and evenly-spaced rungs for a
 * ladder between two points, so it renders as an actual ladder shape.
 */
export function ladderGeometry(
  from: Point,
  to: Point,
  railGap = 2.5,
  rungCount = 5,
): LadderGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length; // perpendicular unit vector
  const py = dx / length;

  const rail1: [Point, Point] = [
    { x: from.x + px * railGap, y: from.y + py * railGap },
    { x: to.x + px * railGap, y: to.y + py * railGap },
  ];
  const rail2: [Point, Point] = [
    { x: from.x - px * railGap, y: from.y - py * railGap },
    { x: to.x - px * railGap, y: to.y - py * railGap },
  ];

  const rungs: [Point, Point][] = [];
  for (let i = 0; i <= rungCount; i++) {
    const t = i / rungCount;
    const baseX = from.x + dx * t;
    const baseY = from.y + dy * t;
    rungs.push([
      { x: baseX + px * railGap, y: baseY + py * railGap },
      { x: baseX - px * railGap, y: baseY - py * railGap },
    ]);
  }

  return { rail1, rail2, rungs };
}
