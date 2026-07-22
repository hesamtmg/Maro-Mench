<script setup lang="ts">
import { computed } from 'vue';
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
}>();

const BOARD_SIZE = 100;

const squares = computed(() =>
  Array.from({ length: BOARD_SIZE }, (_, i) => i + 1),
);

function gridPos(square: number) {
  return squareToGridPosition(square);
}

function playersAt(square: number): RoomPlayer[] {
  return props.players.filter(
    (p) => (props.boardState?.positions?.[p.seatIndex] ?? 0) === square,
  );
}

// Precompute snake body paths and ladder rail/rung geometry once per
// boardState change, since they only depend on the (fixed, per-game)
// snakes/ladders map, not on player positions.
const snakePaths = computed(() => {
  const snakes = props.boardState?.snakes ?? {};
  return Object.entries(snakes).map(([headStr, tail]) => {
    const head = Number(headStr);
    const headCenter = squareToCenterPercent(head);
    const tailCenter = squareToCenterPercent(tail);
    return {
      key: `snake-${head}`,
      d: snakePath(
        { x: headCenter.xPercent, y: headCenter.yPercent },
        { x: tailCenter.xPercent, y: tailCenter.yPercent },
      ),
      headX: headCenter.xPercent,
      headY: headCenter.yPercent,
    };
  });
});

const ladderShapes = computed(() => {
  const ladders = props.boardState?.ladders ?? {};
  return Object.entries(ladders).map(([bottomStr, top]) => {
    const bottom = Number(bottomStr);
    const bottomCenter = squareToCenterPercent(bottom);
    const topCenter = squareToCenterPercent(top);
    const geo = ladderGeometry(
      { x: bottomCenter.xPercent, y: bottomCenter.yPercent },
      { x: topCenter.xPercent, y: topCenter.yPercent },
    );
    return { key: `ladder-${bottom}`, ...geo };
  });
});

function squareType(square: number): 'snake-head' | 'ladder-bottom' | null {
  if (props.boardState?.snakes?.[square] !== undefined) return 'snake-head';
  if (props.boardState?.ladders?.[square] !== undefined)
    return 'ladder-bottom';
  return null;
}
</script>

<template>
  <div class="stack">
    <div class="sl-board">
      <div class="sl-grid">
        <div
          v-for="square in squares"
          :key="square"
          class="sl-square"
          :style="{
            gridRow: gridPos(square).row + 1,
            gridColumn: gridPos(square).col + 1,
          }"
          :class="{
            'sl-snake-head': squareType(square) === 'snake-head',
            'sl-ladder-bottom': squareType(square) === 'ladder-bottom',
          }"
        >
          <span class="square-index">{{ square }}</span>
          <span
            v-for="player in playersAt(square)"
            :key="player.userId"
            class="token-dot"
            :title="player.displayName"
            :style="{ background: player.color ?? '#4f46e5' }"
          />
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
          />
          <line
            :x1="ladder.rail2[0].x"
            :y1="ladder.rail2[0].y"
            :x2="ladder.rail2[1].x"
            :y2="ladder.rail2[1].y"
            class="ladder-rail"
          />
          <line
            v-for="(rung, i) in ladder.rungs"
            :key="i"
            :x1="rung[0].x"
            :y1="rung[0].y"
            :x2="rung[1].x"
            :y2="rung[1].y"
            class="ladder-rung"
          />
        </g>

        <g v-for="snake in snakePaths" :key="snake.key" class="snake">
          <path :d="snake.d" class="snake-body" />
          <circle :cx="snake.headX" :cy="snake.headY" r="2.6" class="snake-head-dot" />
        </g>
      </svg>
    </div>

    <div class="stack">
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
          Square {{ props.boardState?.positions?.[player.seatIndex] ?? 0 }} /
          100
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sl-board {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
}

.sl-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  grid-template-rows: repeat(10, 1fr);
  gap: 2px;
  background: var(--color-border);
  padding: 2px;
  border-radius: var(--radius);
}

.sl-square {
  position: relative;
  background: var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2px;
}

.sl-snake-head {
  background: #fee2e2;
}

.sl-ladder-bottom {
  background: #dcfce7;
}

.square-index {
  position: absolute;
  top: 1px;
  left: 2px;
  font-size: 0.55rem;
  color: var(--color-text-muted);
}

.token-dot,
.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.token-dot {
  animation: pop-in 0.2s ease-out;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
  position: relative;
  z-index: 2; /* keep tokens above the SVG overlay */
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

.color-dot {
  width: 12px;
  height: 12px;
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
  stroke: #c0392b;
  stroke-width: 1.6;
  stroke-linecap: round;
  opacity: 0.85;
}

.snake-head-dot {
  fill: #8b1a1a;
}

.ladder-rail {
  stroke: #92660f;
  stroke-width: 1.1;
  stroke-linecap: round;
  opacity: 0.85;
}

.ladder-rung {
  stroke: #b8842a;
  stroke-width: 0.8;
  opacity: 0.85;
}

.player-row {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
  transition: background 0.2s ease;
}

.player-row-active {
  background: #eef2ff;
}
</style>
