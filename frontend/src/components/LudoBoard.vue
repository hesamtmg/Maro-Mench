<script setup lang="ts">
import { computed } from 'vue';
import type { RoomPlayer } from '../types';
import {
  FINISHED_POSITION,
  GRID_SIZE,
  HOME_LANE_CELLS,
  RING_CELLS,
  SAFE_SQUARE_POSITIONS,
  positionToCell,
} from './ludo/board-geometry';

interface LudoToken {
  tokenId: number;
  position: number; // -1 home, 0-51 track, 52-57 home run, 58 finished
}

interface LudoBoardState {
  tokens: Record<number, LudoToken[]>;
}

const props = defineProps<{
  boardState: LudoBoardState;
  players: RoomPlayer[];
  isMyTurn: boolean;
  awaitingMoveChoice: boolean;
  myTokens: LudoToken[];
  currentTurnSeat?: number | null;
}>();

const emit = defineEmits<{
  selectToken: [tokenId: number];
}>();

// Fallback colors match the seat-index -> color convention the backend
// assigns (RoomsService.LUDO_COLORS), used only if a player's color is
// somehow missing from room state.
const SEAT_FALLBACK_COLORS = ['#e33e3e', '#3aa15c', '#e8b93e', '#3f6fd1'];
const YARD_CLASSES = ['yard-0', 'yard-1', 'yard-2', 'yard-3'];

function colorForSeat(seatIndex: number): string {
  return (
    props.players.find((p) => p.seatIndex === seatIndex)?.color ??
    SEAT_FALLBACK_COLORS[seatIndex] ??
    '#999'
  );
}

interface OccupiedCell {
  seatIndex: number;
  token: LudoToken;
  color: string;
  selectable: boolean;
}

// Map of "row,col" -> tokens currently occupying that cell, built fresh
// whenever boardState changes.
const cellOccupants = computed(() => {
  const map = new Map<string, OccupiedCell[]>();
  const myTokenIds = new Set(props.myTokens.map((t) => t.tokenId));
  const canSelectNow = props.isMyTurn && props.awaitingMoveChoice;

  for (const player of props.players) {
    const tokens = props.boardState?.tokens?.[player.seatIndex] ?? [];
    for (const token of tokens) {
      const cell = positionToCell(player.seatIndex, token.position);
      if (!cell) continue; // at home or finished -- not drawn on the grid
      const key = `${cell[0]},${cell[1]}`;
      const list = map.get(key) ?? [];
      list.push({
        seatIndex: player.seatIndex,
        token,
        color: player.color ?? SEAT_FALLBACK_COLORS[player.seatIndex],
        selectable: canSelectNow && myTokenIds.has(token.tokenId),
      });
      map.set(key, list);
    }
  }
  return map;
});

function occupantsAt(row: number, col: number): OccupiedCell[] {
  return cellOccupants.value.get(`${row},${col}`) ?? [];
}

function isSafeCell(row: number, col: number): boolean {
  return RING_CELLS.some(
    ([r, c], idx) => r === row && c === col && SAFE_SQUARE_POSITIONS.has(idx),
  );
}

function laneColorClass(row: number, col: number): string | null {
  for (const seat of [0, 1, 2, 3] as const) {
    if (HOME_LANE_CELLS[seat].some(([r, c]) => r === row && c === col)) {
      return `lane-${seat}`;
    }
  }
  return null;
}

// All non-yard, non-center cells: ring + all 4 lanes, deduplicated.
const trackCells = computed(() => {
  const seen = new Set<string>();
  const cells: { row: number; col: number }[] = [];
  const add = (row: number, col: number) => {
    const key = `${row},${col}`;
    if (!seen.has(key)) {
      seen.add(key);
      cells.push({ row, col });
    }
  };
  for (const [r, c] of RING_CELLS) add(r, c);
  for (const seat of [0, 1, 2, 3] as const) {
    for (const [r, c] of HOME_LANE_CELLS[seat]) add(r, c);
  }
  return cells;
});

function homeCount(seatIndex: number): number {
  return (props.boardState?.tokens?.[seatIndex] ?? []).filter(
    (t) => t.position === -1,
  ).length;
}

function finishedCount(seatIndex: number): number {
  return (props.boardState?.tokens?.[seatIndex] ?? []).filter(
    (t) => t.position === FINISHED_POSITION,
  ).length;
}

function onTokenClick(occupant: OccupiedCell) {
  if (occupant.selectable) {
    emit('selectToken', occupant.token.tokenId);
  }
}
</script>

<template>
  <div class="ludo-wrapper">
    <div class="ludo-board" :style="{ '--grid-size': GRID_SIZE }">
      <!-- Yards -->
      <div
        v-for="seat in [0, 1, 2, 3]"
        :key="`yard-${seat}`"
        class="yard"
        :class="YARD_CLASSES[seat]"
      >
        <div class="yard-inner">
          <div
            v-for="slotIndex in [0, 1, 2, 3]"
            :key="slotIndex"
            class="yard-slot"
          >
            <div
              v-if="slotIndex < homeCount(seat)"
              class="token"
              :style="{ background: colorForSeat(seat) }"
            />
          </div>
        </div>
      </div>

      <!-- Center home -->
      <div class="center">
        <span class="center-icon">🏠</span>
      </div>

      <!-- Track cells (ring + home lanes) -->
      <div
        v-for="cellPos in trackCells"
        :key="`${cellPos.row}-${cellPos.col}`"
        class="track-cell"
        :class="[
          laneColorClass(cellPos.row, cellPos.col),
          { safe: isSafeCell(cellPos.row, cellPos.col) },
        ]"
        :style="{ gridRow: cellPos.row, gridColumn: cellPos.col }"
      >
        <button
          v-for="occupant in occupantsAt(cellPos.row, cellPos.col)"
          :key="`${occupant.seatIndex}-${occupant.token.tokenId}`"
          class="token track-token"
          :class="{ selectable: occupant.selectable }"
          :style="{ background: occupant.color }"
          :disabled="!occupant.selectable"
          @click="onTokenClick(occupant)"
        />
      </div>
    </div>

    <div class="stack player-summary">
      <div
        v-for="player in props.players"
        :key="player.userId"
        class="row player-row"
        :class="{
          'player-row-active': player.seatIndex === props.currentTurnSeat,
        }"
      >
        <span
          class="color-dot"
          :style="{ background: colorForSeat(player.seatIndex) }"
        />
        <strong>{{ player.displayName }}</strong>
        <span class="text-muted">
          Home: {{ homeCount(player.seatIndex) }} · Finished:
          {{ finishedCount(player.seatIndex) }} / 4
        </span>
      </div>
    </div>

    <p
      v-if="props.isMyTurn && props.awaitingMoveChoice"
      class="choose-hint"
    >
      Tap a highlighted token to move it.
    </p>
  </div>
</template>

<style scoped>
.ludo-wrapper {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
}

.ludo-board {
  display: grid;
  grid-template-columns: repeat(var(--grid-size), 1fr);
  grid-template-rows: repeat(var(--grid-size), 1fr);
  width: 100%;
  aspect-ratio: 1;
  background: #fdfaf3;
  border: 2px solid #2b2b2b;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
}

/* Yards */
.yard {
  display: grid;
  place-items: center;
}
.yard-0 {
  grid-row: 1 / 7;
  grid-column: 1 / 7;
  background: #e33e3e;
}
.yard-1 {
  grid-row: 1 / 7;
  grid-column: 10 / 16;
  background: #3aa15c;
}
.yard-2 {
  grid-row: 10 / 16;
  grid-column: 10 / 16;
  background: #e8b93e;
}
.yard-3 {
  grid-row: 10 / 16;
  grid-column: 1 / 7;
  background: #3f6fd1;
}

.yard-inner {
  width: 76%;
  height: 76%;
  background: #fdfaf3;
  border-radius: 14%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 8%;
  padding: 8%;
}

.yard-slot {
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  display: grid;
  place-items: center;
}

/* Center */
.center {
  grid-row: 7 / 10;
  grid-column: 7 / 10;
  background: conic-gradient(
    from 0deg,
    #e33e3e 0deg 90deg,
    #3aa15c 90deg 180deg,
    #e8b93e 180deg 270deg,
    #3f6fd1 270deg 360deg
  );
  display: grid;
  place-items: center;
  font-size: min(6vw, 28px);
}

/* Track cells */
.track-cell {
  border: 1px solid #e2dbc9;
  background: #fdfaf3;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.track-cell.safe::before {
  content: '★';
  position: absolute;
  font-size: 0.55rem;
  color: #b8ae94;
  top: 1px;
  left: 2px;
}

.lane-0 {
  background: rgba(227, 62, 62, 0.22);
}
.lane-1 {
  background: rgba(58, 161, 92, 0.22);
}
.lane-2 {
  background: rgba(232, 185, 62, 0.22);
}
.lane-3 {
  background: rgba(63, 111, 209, 0.22);
}

/* Tokens */
.token {
  width: 68%;
  aspect-ratio: 1;
  border-radius: 50%;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.35),
    inset 0 -3px 0 rgba(0, 0, 0, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.6);
  padding: 0;
  cursor: default;
  animation: pop-in 0.2s ease-out;
}

.track-token {
  position: absolute;
  inset: 10%;
  width: auto;
  height: auto;
}

.token.selectable {
  cursor: pointer;
  box-shadow:
    0 0 0 3px rgba(79, 70, 229, 0.6),
    0 2px 6px rgba(0, 0, 0, 0.35);
  animation:
    pop-in 0.2s ease-out,
    pulse 1s ease-in-out infinite;
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

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.12);
  }
}

/* Player summary */
.player-summary {
  margin-top: 1.25rem;
}

.color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}

.player-row {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
  transition: background 0.2s ease;
}

.player-row-active {
  background: #eef2ff;
}

.choose-hint {
  margin-top: 0.75rem;
  text-align: center;
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
