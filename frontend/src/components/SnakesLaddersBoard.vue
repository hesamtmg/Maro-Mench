<script setup lang="ts">
import { computed, onUnmounted, reactive, watch } from 'vue';
import type { RoomPlayer } from '../types';
import { squareToCenterPercent, squareToGridPosition } from './snakes-ladders/board-geometry';
import { ladderGeometry, snakePath } from './snakes-ladders/svg-shapes';

interface SnakesLaddersState {
  positions: Record<number, number>;
  snakes: Record<number, number>;
  ladders: Record<number, number>;
}

const props = defineProps<{
  boardState: SnakesLaddersState;
  players: RoomPlayer[];
  currentTurnSeat?: number | null;
  // Set when the page itself renders an equivalent player-status panel
  // elsewhere (e.g. RoomView's sidebar on wide screens), so it isn't
  // shown twice.
  hidePlayerSummary?: boolean;
}>();

const BOARD_SIZE = 100;

const squares = computed(() =>
  Array.from({ length: BOARD_SIZE }, (_, i) => i + 1),
);

function gridPos(square: number) {
  return squareToGridPosition(square);
}

// Diagonal 5-color patchwork, matching the classic wooden-board look
// (colored squares, not a plain 2-color checkerboard).
const CELL_COLORS = ['#e6483c', '#f0b429', '#2f6fed', '#3aa15c', '#f5ecd7'];

function cellColor(square: number): string {
  const { row, col } = gridPos(square);
  return CELL_COLORS[(row + col) % CELL_COLORS.length];
}

// Cream squares need dark text; the saturated colors read better with
// white text, so the number's color follows the cell it sits on.
function textColor(square: number): string {
  return cellColor(square) === '#f5ecd7' ? '#2b2b2b' : '#fff';
}

// --- Move animation ------------------------------------------------
// The server just hands us the *final* position after a roll (and after
// any snake/ladder teleport already applied). To make that read as an
// actual move instead of a token teleporting, we keep our own lagging
// "displayed" position per seat and hop it forward one square at a time,
// finishing with a distinct jump for the snake/ladder teleport itself.
const displayPositions = reactive<Record<number, number>>({});
const specialEffect = reactive<Record<number, 'snake' | 'ladder' | null>>({});
const animationTimers: Record<number, ReturnType<typeof setTimeout>[]> = {};

const STEP_MS = 160;
const MAX_ANIMATED_HOPS = 30; // defensive cap; snap instead if exceeded

function clearSeatAnimation(seatIndex: number) {
  for (const timer of animationTimers[seatIndex] ?? []) clearTimeout(timer);
  animationTimers[seatIndex] = [];
}

function invert(map: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [from, to] of Object.entries(map)) out[to] = Number(from);
  return out;
}

function animateSeatTo(seatIndex: number, target: number) {
  clearSeatAnimation(seatIndex);
  const start = displayPositions[seatIndex] ?? 0;

  if (target <= start) {
    // Not a normal forward roll (shouldn't happen outside a fresh
    // boardState swap) -- just snap rather than animating backwards.
    displayPositions[seatIndex] = target;
    return;
  }

  const snakeTailToHead = invert(props.boardState?.snakes ?? {});
  const ladderTopToBottom = invert(props.boardState?.ladders ?? {});
  const teleportKind: 'snake' | 'ladder' | null =
    snakeTailToHead[target] !== undefined
      ? 'snake'
      : ladderTopToBottom[target] !== undefined
        ? 'ladder'
        : null;
  const walkEnd =
    teleportKind === 'snake'
      ? snakeTailToHead[target]
      : teleportKind === 'ladder'
        ? ladderTopToBottom[target]
        : target;

  const hops: number[] = [];
  for (let square = start + 1; square <= walkEnd; square++) hops.push(square);
  if (teleportKind) hops.push(target);

  if (hops.length === 0 || hops.length > MAX_ANIMATED_HOPS) {
    displayPositions[seatIndex] = target;
    return;
  }

  const timers: ReturnType<typeof setTimeout>[] = [];
  hops.forEach((square, i) => {
    const isTeleportHop = teleportKind && i === hops.length - 1;
    // A small pause before the teleport hop separates "walking up to the
    // snake/ladder" from "being swallowed/climbing", instead of it
    // reading as just one more regular step.
    const delay = i * STEP_MS + (isTeleportHop ? 220 : 0);
    timers.push(
      setTimeout(() => {
        displayPositions[seatIndex] = square;
        if (isTeleportHop && teleportKind) {
          specialEffect[seatIndex] = teleportKind;
          const clearEffect = setTimeout(() => {
            specialEffect[seatIndex] = null;
          }, 550);
          animationTimers[seatIndex].push(clearEffect);
        }
      }, delay),
    );
  });
  animationTimers[seatIndex] = timers;
}

watch(
  () => props.boardState?.positions,
  (positions, previousPositions) => {
    if (!positions) return;
    for (const seatStr of Object.keys(positions)) {
      const seatIndex = Number(seatStr);
      const newPos = positions[seatIndex];
      if (displayPositions[seatIndex] === undefined) {
        // First time seeing this seat (game just started) -- nothing to
        // animate from.
        displayPositions[seatIndex] = newPos;
        continue;
      }
      if (previousPositions?.[seatIndex] === newPos) continue;
      animateSeatTo(seatIndex, newPos);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  for (const seatIndex of Object.keys(animationTimers)) {
    clearSeatAnimation(Number(seatIndex));
  }
});

// Small deterministic spread so tokens sharing a square don't sit
// exactly on top of one another (percentage points, relative to the
// square's own center).
const SEAT_SPREAD = [
  { dx: -1.8, dy: -1.8 },
  { dx: 1.8, dy: -1.8 },
  { dx: -1.8, dy: 1.8 },
  { dx: 1.8, dy: 1.8 },
];

// One persistent, absolutely-positioned token per player (not
// recreated per square) so moving between squares is a smooth CSS
// transition of left/top rather than the DOM node popping in and out
// of a new parent every hop.
const tokenPositions = computed(() => {
  return props.players
    .map((player) => {
      const square = displayPositions[player.seatIndex] ?? 0;
      if (square < 1 || square > BOARD_SIZE) return null;
      const center = squareToCenterPercent(square);
      const spread = SEAT_SPREAD[player.seatIndex % SEAT_SPREAD.length];
      return {
        userId: player.userId,
        displayName: player.displayName,
        seatIndex: player.seatIndex,
        color: player.color ?? '#4f46e5',
        xPercent: center.xPercent + spread.dx,
        yPercent: center.yPercent + spread.dy,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
});

function squareType(square: number): 'snake-head' | 'ladder-bottom' | null {
  if (props.boardState?.snakes?.[square] !== undefined) return 'snake-head';
  if (props.boardState?.ladders?.[square] !== undefined)
    return 'ladder-bottom';
  return null;
}

// Cycled per snake/ladder so multiple snakes/ladders on the same board
// read as visually distinct, like the painted wooden board.
const SNAKE_COLORS = ['#1f7a8c', '#8e44ad', '#2e8b57', '#c0392b', '#d35400'];
// Lighter tint of each SNAKE_COLORS entry (same order), drawn as a thin
// stripe on top of the body to fake a rounded, scaled belly highlight.
const SNAKE_BELLY_COLORS = [
  '#5fb8c9',
  '#c58ee0',
  '#6fcf97',
  '#e77b6b',
  '#f4a460',
];
const LADDER_COLORS = ['#8b5a2b', '#6b4226', '#a0672f'];

// Head is drawn as an ellipse (not a plain circle) so it reads as an
// actual head shape: longer along the direction of travel, narrower
// across it.
const SNAKE_HEAD_RX = 3;
const SNAKE_HEAD_RY = 2.1;

// Precompute snake body paths and ladder rail/rung geometry once per
// boardState change, since they only depend on the (fixed, per-game)
// snakes/ladders map, not on player positions.
const snakePaths = computed(() => {
  const snakes = props.boardState?.snakes ?? {};
  return Object.entries(snakes).map(([headStr, tail], index) => {
    const head = Number(headStr);
    const headCenter = squareToCenterPercent(head);
    const tailCenter = squareToCenterPercent(tail);

    // Unit vector pointing from the tail toward the head, i.e. the
    // direction the snake is "facing" -- used to place the eyes and
    // tongue on the head so they read as a face rather than a dot.
    const dx = headCenter.xPercent - tailCenter.xPercent;
    const dy = headCenter.yPercent - tailCenter.yPercent;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy; // perpendicular unit vector
    const py = ux;

    // Angle (degrees) to rotate the head ellipse so its long axis lines
    // up with the direction of travel, rather than sitting axis-aligned.
    const headAngle = Math.atan2(uy, ux) * (180 / Math.PI);

    const eyeForward = 1;
    const eyeSpread = 1.2;
    const eye1 = {
      x: headCenter.xPercent + ux * eyeForward + px * eyeSpread,
      y: headCenter.yPercent + uy * eyeForward + py * eyeSpread,
    };
    const eye2 = {
      x: headCenter.xPercent + ux * eyeForward - px * eyeSpread,
      y: headCenter.yPercent + uy * eyeForward - py * eyeSpread,
    };

    const tongueBase = {
      x: headCenter.xPercent + ux * SNAKE_HEAD_RX,
      y: headCenter.yPercent + uy * SNAKE_HEAD_RX,
    };
    const tongueTip = {
      x: headCenter.xPercent + ux * (SNAKE_HEAD_RX + 3),
      y: headCenter.yPercent + uy * (SNAKE_HEAD_RX + 3),
    };
    const tongueFork1 = {
      x: tongueTip.x + px * 1.1,
      y: tongueTip.y + py * 1.1,
    };
    const tongueFork2 = {
      x: tongueTip.x - px * 1.1,
      y: tongueTip.y - py * 1.1,
    };

    return {
      key: `snake-${head}`,
      d: snakePath(
        { x: headCenter.xPercent, y: headCenter.yPercent },
        { x: tailCenter.xPercent, y: tailCenter.yPercent },
      ),
      headX: headCenter.xPercent,
      headY: headCenter.yPercent,
      headAngle,
      color: SNAKE_COLORS[index % SNAKE_COLORS.length],
      bellyColor: SNAKE_BELLY_COLORS[index % SNAKE_BELLY_COLORS.length],
      eye1,
      eye2,
      tongueBase,
      tongueFork1,
      tongueFork2,
    };
  });
});

const ladderShapes = computed(() => {
  const ladders = props.boardState?.ladders ?? {};
  return Object.entries(ladders).map(([bottomStr, top], index) => {
    const bottom = Number(bottomStr);
    const bottomCenter = squareToCenterPercent(bottom);
    const topCenter = squareToCenterPercent(top);
    const geo = ladderGeometry(
      { x: bottomCenter.xPercent, y: bottomCenter.yPercent },
      { x: topCenter.xPercent, y: topCenter.yPercent },
    );
    return {
      key: `ladder-${bottom}`,
      ...geo,
      color: LADDER_COLORS[index % LADDER_COLORS.length],
    };
  });
});
</script>

<template>
  <div class="stack">
    <div class="sl-wrapper">
      <div class="sl-board">
        <div class="sl-frame">
          <div class="sl-grid">
            <div
              v-for="square in squares"
              :key="square"
              class="sl-square"
              :class="{
              'sl-snake-head': squareType(square) === 'snake-head',
              'sl-ladder-bottom': squareType(square) === 'ladder-bottom',
            }"
            :style="{
              gridRow: gridPos(square).row + 1,
              gridColumn: gridPos(square).col + 1,
              background: cellColor(square),
              color: textColor(square),
            }"
          >
            <span class="square-index">{{ square }}</span>
          </div>
        </div>

        <!-- SVG overlay: real snake bodies and ladder rails/rungs, drawn
             over the grid using percent-based coordinates so they scale
             with the board regardless of pixel size. -->
        <svg class="sl-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
          <g v-for="ladder in ladderShapes" :key="ladder.key" class="ladder">
            <line
              :x1="ladder.rail1[0].x"
              :y1="ladder.rail1[0].y"
              :x2="ladder.rail1[1].x"
              :y2="ladder.rail1[1].y"
              class="ladder-rail"
              :style="{ stroke: ladder.color }"
            />
            <line
              :x1="ladder.rail2[0].x"
              :y1="ladder.rail2[0].y"
              :x2="ladder.rail2[1].x"
              :y2="ladder.rail2[1].y"
              class="ladder-rail"
              :style="{ stroke: ladder.color }"
            />
            <line
              v-for="(rung, i) in ladder.rungs"
              :key="i"
              :x1="rung[0].x"
              :y1="rung[0].y"
              :x2="rung[1].x"
              :y2="rung[1].y"
              class="ladder-rung"
              :style="{ stroke: ladder.color }"
            />
          </g>

          <g v-for="snake in snakePaths" :key="snake.key" class="snake">
            <!-- Body: a thick colored stroke plus a thin lighter stripe on
                 top to fake a rounded belly, so it reads as a tube rather
                 than a flat line. -->
            <path :d="snake.d" class="snake-body" :style="{ stroke: snake.color }" />
            <path
              :d="snake.d"
              class="snake-belly"
              :style="{ stroke: snake.bellyColor }"
            />

            <!-- Tongue: a small forked flick out the front of the head. -->
            <line
              :x1="snake.tongueBase.x"
              :y1="snake.tongueBase.y"
              :x2="snake.tongueFork1.x"
              :y2="snake.tongueFork1.y"
              class="snake-tongue"
            />
            <line
              :x1="snake.tongueBase.x"
              :y1="snake.tongueBase.y"
              :x2="snake.tongueFork2.x"
              :y2="snake.tongueFork2.y"
              class="snake-tongue"
            />

            <ellipse
              :cx="snake.headX"
              :cy="snake.headY"
              :rx="SNAKE_HEAD_RX"
              :ry="SNAKE_HEAD_RY"
              :transform="`rotate(${snake.headAngle} ${snake.headX} ${snake.headY})`"
              class="snake-head-dot"
              :style="{ fill: snake.color, stroke: snake.color }"
            />

            <!-- Eyes, so the head reads as a face rather than a plain dot. -->
            <circle :cx="snake.eye1.x" :cy="snake.eye1.y" r="0.55" class="snake-eye" />
            <circle :cx="snake.eye2.x" :cy="snake.eye2.y" r="0.55" class="snake-eye" />
          </g>
        </svg>

        <!-- Tokens: one persistent element per player, positioned by
             percent and moved via a CSS transition on left/top -- so a
             move glides smoothly square-to-square instead of the token
             popping in and out of a new parent every hop. -->
        <div class="tokens-overlay">
          <span
            v-for="token in tokenPositions"
            :key="token.userId"
            class="token-dot"
            :class="{
              'token-bitten': specialEffect[token.seatIndex] === 'snake',
              'token-climbing': specialEffect[token.seatIndex] === 'ladder',
            }"
            :title="token.displayName"
            :style="{
              left: `${token.xPercent}%`,
              top: `${token.yPercent}%`,
              background: token.color,
            }"
          />
        </div>
      </div>
    </div>
    </div>

    <div v-if="!hidePlayerSummary" class="stack">
      <div
        v-for="player in props.players"
        :key="player.userId"
        class="row player-row"
        :class="{ 'player-row-active': player.seatIndex === props.currentTurnSeat }"
      >
        <span
          class="color-dot"
          :style="{ background: player.color ?? '#4f46e5' }"
        />
        <strong>{{ player.displayName }}</strong>
        <span class="text-muted">
          Square {{ displayPositions[player.seatIndex] ?? 0 }} /
          100
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sl-wrapper {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  /* Vanishing point for the board's tilt below -- kept on the wrapper so
     the perspective is shared with the drop shadow, which sits outside
     the tilted element itself. */
  perspective: 1400px;
}

.sl-board {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  box-sizing: border-box;
  padding: 3%;
  background: linear-gradient(155deg, #e8c27a, #c9964f);
  border: 3px solid #2b2b2b;
  border-radius: 16px;
  /* Slight tabletop tilt plus a soft shadow beneath, so the board reads
     as a physical object resting on a surface rather than a flat image. */
  transform: rotateX(6deg);
  transform-origin: center bottom;
  box-shadow:
    0 24px 36px rgba(0, 0, 0, 0.4),
    0 4px 10px rgba(0, 0, 0, 0.3),
    inset 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.sl-frame {
  position: relative;
  width: 100%;
  height: 100%;
}

.sl-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  grid-template-rows: repeat(10, 1fr);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.35);
}

.sl-square {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 3px rgba(0, 0, 0, 0.15);
}

.square-index {
  position: absolute;
  top: 2%;
  left: 4%;
  font-size: 0.65rem;
  font-weight: 800;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
}

.token-dot,
.color-dot {
  border-radius: 50%;
  display: inline-block;
  border: 1px solid rgba(0, 0, 0, 0.35);
}

.color-dot {
  width: 10px;
  height: 10px;
}

/* Overlay holding every player's token as one persistent, absolutely
   positioned element each -- so moving between squares is Vue updating
   left/top on the same DOM node (smoothly tweened below), never
   destroying and recreating it in a new parent. */
.tokens-overlay {
  position: absolute;
  inset: 0;
  z-index: 2; /* above the SVG snake/ladder overlay */
  pointer-events: none;
}

/* Styled like a small glass/marble playing piece -- a raised sphere with
   a shadowed underside and a bright highlight near the top, rather than
   a flat color dot. Sized up from the legend's plain color-dot so the
   3D shading actually reads at board scale. */
.token-dot {
  position: absolute;
  width: 26px;
  height: 26px;
  overflow: hidden;
  transform: translate(-50%, -50%);
  transition:
    left 0.14s linear,
    top 0.14s linear;
  pointer-events: auto;
  box-shadow:
    0 4px 6px rgba(0, 0, 0, 0.6),
    inset 0 -6px 8px rgba(0, 0, 0, 0.5),
    inset 0 3px 4px rgba(255, 255, 255, 0.4);
}

/* Kept small and low-opacity, close to the rim only -- these are a
   subtle sheen accent, not a wash that would cover up each player's
   actual color and make every token look the same shade of gray. */
.token-dot::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 70% 74%,
    rgba(0, 0, 0, 0.4),
    transparent 32%
  );
  pointer-events: none;
}

.token-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 30% 24%,
    rgba(255, 255, 255, 0.85),
    transparent 26%
  );
  pointer-events: none;
}

@keyframes pop-in {
  0% {
    transform: scale(0.3);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Brief reaction on the token's landing square itself, right as the
   snake-swallow/ladder-climb sound plays -- separate from the board-wide
   celebration overlay, so it's clear *which* token got hit. */
.token-dot.token-bitten {
  animation: token-bitten 0.55s ease-out;
}

/* Each keyframe re-states the base translate(-50%, -50%) centering
   transform from .token-dot alongside the effect itself, since a
   running animation's transform replaces (rather than composes with)
   the element's own -- otherwise the token would jump off-center for
   the animation's duration. */
@keyframes token-bitten {
  0% {
    transform: translate(-50%, -50%) scale(1);
  }
  30% {
    transform: translate(-50%, -50%) scale(1.3, 0.7);
    filter: brightness(0.7) saturate(1.5);
  }
  60% {
    transform: translate(-50%, -50%) scale(0.8, 1.1);
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
  }
}

.token-dot.token-climbing {
  animation: token-climbing 0.55s ease-out;
}

@keyframes token-climbing {
  0% {
    transform: translate(-50%, -50%) translateY(0) scale(1);
  }
  40% {
    transform: translate(-50%, -50%) translateY(-10px) scale(1.15);
    filter: brightness(1.25);
  }
  100% {
    transform: translate(-50%, -50%) translateY(0) scale(1);
  }
}

.color-dot {
  width: 12px;
  height: 12px;
  box-shadow:
    inset 0 -2px 2px rgba(0, 0, 0, 0.35),
    inset 0 1px 1px rgba(255, 255, 255, 0.5);
}

.sl-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.snake-body {
  fill: none;
  stroke-width: 3.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.95;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}

/* Thin lighter stripe drawn over the same path as .snake-body, tracing
   its top-center, so the body reads as a rounded tube (like a belly)
   instead of a flat ribbon. */
.snake-belly {
  fill: none;
  stroke-width: 1.1;
  stroke-linecap: round;
  opacity: 0.8;
}

.snake-tongue {
  stroke: #b91c1c;
  stroke-width: 0.6;
  stroke-linecap: round;
}

.snake-eye {
  fill: #111827;
  stroke: white;
  stroke-width: 0.3;
}

.snake-head-dot {
  opacity: 0.95;
  /* stroke color is set inline to match each snake's body color */
  stroke-width: 0.6;
}

.ladder-rail {
  stroke-width: 1.4;
  stroke-linecap: round;
  opacity: 0.9;
}

.ladder-rung {
  stroke-width: 1.1;
  opacity: 0.9;
}

.player-row {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
  transition: background 0.2s ease;
}

.player-row-active {
  background: rgba(147, 51, 234, 0.18);
}
</style>
