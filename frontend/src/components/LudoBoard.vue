<script setup lang="ts">
import { computed } from 'vue';
import type { RoomPlayer } from '../types';
import {
  ENTRY_OFFSETS,
  FINISHED_POSITION,
  GRID_SIZE,
  HOME_LANE_CELLS,
  RING_CELLS,
  SAFE_SQUARE_POSITIONS,
  positionToCell,
} from './ludo/board-geometry';
import { computeDestinationPosition } from './ludo/move-preview';

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
  mySeatIndex?: number | null;
  diceValue?: number | null;
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
  key?: string;
  seatIndex: number;
  token: LudoToken;
  color: string;
  displayName: string;
  selectable: boolean;
  row?: number;
  col?: number;
}

const myTokenIds = computed(
  () => new Set(props.myTokens.map((t) => t.tokenId)),
);
const canSelectNow = computed(
  () => props.isMyTurn && props.awaitingMoveChoice,
);

// Flat list of every on-track token (ring + home lanes), each keyed
// stably by seat+tokenId so a single move re-renders the *same* DOM node
// at a new grid position rather than destroying/recreating it -- that's
// what lets <TransitionGroup> animate the slide instead of popping the
// token straight to its new cell.
const trackTokens = computed(() => {
  const list: OccupiedCell[] = [];
  for (const player of props.players) {
    const tokens = props.boardState?.tokens?.[player.seatIndex] ?? [];
    for (const token of tokens) {
      const cell = positionToCell(player.seatIndex, token.position);
      if (!cell) continue; // at home or finished -- not drawn on the grid
      list.push({
        key: `${player.seatIndex}-${token.tokenId}`,
        seatIndex: player.seatIndex,
        token,
        color: player.color ?? SEAT_FALLBACK_COLORS[player.seatIndex],
        displayName: player.displayName,
        selectable: canSelectNow.value && myTokenIds.value.has(token.tokenId),
        row: cell[0],
        col: cell[1],
      });
    }
  }
  return list;
});

// Yard tokens (position -1) aren't on the grid, so they're tracked
// separately, padded to 4 slots so empty slots still render as empty.
function yardSlots(seatIndex: number): (OccupiedCell | null)[] {
  const tokens = (props.boardState?.tokens?.[seatIndex] ?? []).filter(
    (t) => t.position === -1,
  );
  const color = colorForSeat(seatIndex);
  const displayName =
    props.players.find((p) => p.seatIndex === seatIndex)?.displayName ?? '';
  const slots: (OccupiedCell | null)[] = tokens.map((token) => ({
    seatIndex,
    token,
    color,
    displayName,
    selectable: canSelectNow.value && myTokenIds.value.has(token.tokenId),
  }));
  while (slots.length < 4) slots.push(null);
  return slots;
}

interface DestinationMarker {
  tokenId: number;
  row: number;
  col: number;
  color: string;
}

// Where each of my movable tokens would land if chosen, given the current
// roll -- lets the player tap the destination square itself rather than
// having to recognize which token to tap first.
const destinationMarkers = computed<DestinationMarker[]>(() => {
  if (!canSelectNow.value || props.diceValue == null || props.mySeatIndex == null) {
    return [];
  }
  const seatIndex = props.mySeatIndex;
  const color = colorForSeat(seatIndex);
  const markers: DestinationMarker[] = [];
  for (const token of props.myTokens) {
    const destination = computeDestinationPosition(
      seatIndex,
      token.position,
      props.diceValue,
    );
    if (destination == null) continue;
    const cell = positionToCell(seatIndex, destination);
    if (!cell) continue; // e.g. landing exactly on the finish -- no grid cell to mark
    markers.push({ tokenId: token.tokenId, row: cell[0], col: cell[1], color });
  }
  return markers;
});

function onDestinationClick(marker: DestinationMarker) {
  emit('selectToken', marker.tokenId);
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

// The one ring square each color's tokens actually enter the track
// from -- colored vividly like a "station", same as that color's
// yard/corridor, instead of blending into the plain ring.
function entryColorClass(row: number, col: number): string | null {
  for (const seat of [0, 1, 2, 3] as const) {
    const [r, c] = RING_CELLS[ENTRY_OFFSETS[seat]];
    if (r === row && c === col) return `entry-${seat}`;
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
            v-for="(occupant, slotIndex) in yardSlots(seat)"
            :key="slotIndex"
            class="yard-slot"
          >
            <button
              v-if="occupant"
              class="token"
              :class="{ selectable: occupant.selectable }"
              :style="{ background: occupant.color }"
              :disabled="!occupant.selectable"
              :title="occupant.displayName"
              @click="onTokenClick(occupant)"
            />
          </div>
        </div>
      </div>

      <!-- Center home: 4 solid triangles meeting at a point (classic
           Ludo look), one per color, each on the side its own home
           lane enters from -- left=red, top=green, right=yellow,
           bottom=blue (matches HOME_LANE_CELLS exactly). -->
      <div class="center">
        <span class="center-triangle center-triangle-left" />
        <span class="center-triangle center-triangle-top" />
        <span class="center-triangle center-triangle-right" />
        <span class="center-triangle center-triangle-bottom" />
      </div>

      <!-- Track cells (ring + home lanes) -->
      <div
        v-for="cellPos in trackCells"
        :key="`${cellPos.row}-${cellPos.col}`"
        class="track-cell"
        :class="[
          laneColorClass(cellPos.row, cellPos.col),
          entryColorClass(cellPos.row, cellPos.col),
          { safe: isSafeCell(cellPos.row, cellPos.col) },
        ]"
        :style="{ gridRow: cellPos.row, gridColumn: cellPos.col }"
      />

      <!-- Tokens on the track, in a single flat list keyed by seat+tokenId
           so moving a token slides the same DOM node instead of
           recreating it in a new cell. -->
      <TransitionGroup
        tag="div"
        name="token-move"
        class="tokens-layer"
        :style="{ '--grid-size': GRID_SIZE }"
      >
        <button
          v-for="occupant in trackTokens"
          :key="occupant.key"
          class="token track-token"
          :class="{ selectable: occupant.selectable }"
          :style="{
            background: occupant.color,
            // Explicit end lines matter here: an absolutely-positioned
            // grid child with only a start line has its containing block
            // extend to the grid's far edge (per spec), not just its own
            // cell -- which blew this up to a huge, wrongly-inset token.
            gridRow: `${occupant.row} / span 1`,
            gridColumn: `${occupant.col} / span 1`,
          }"
          :disabled="!occupant.selectable"
          :title="occupant.displayName"
          @click="onTokenClick(occupant)"
        />
      </TransitionGroup>

      <!-- Destination previews: one dot per movable token, at the cell it
           would land on if chosen. Tapping a dot moves that token. -->
      <TransitionGroup
        tag="div"
        name="dot-fade"
        class="dots-layer"
        :style="{ '--grid-size': GRID_SIZE }"
      >
        <button
          v-for="marker in destinationMarkers"
          :key="`dot-${marker.tokenId}`"
          class="move-dot"
          :style="{
            gridRow: `${marker.row} / span 1`,
            gridColumn: `${marker.col} / span 1`,
            background: marker.color,
          }"
          :aria-label="`Move token to this square`"
          @click="onDestinationClick(marker)"
        />
      </TransitionGroup>
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
      Tap a highlighted token or its destination dot to move it.
    </p>
  </div>
</template>

<style scoped>
.ludo-wrapper {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  /* Vanishing point for the board's tilt below -- kept on the wrapper so
     the perspective is shared with the drop shadow, which sits outside
     the tilted element itself. */
  perspective: 1400px;
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
  /* Slight tabletop tilt plus a soft shadow beneath, so the board reads
     as a physical object resting on a surface rather than a flat image. */
  transform: rotateX(6deg);
  transform-origin: center bottom;
  box-shadow:
    0 24px 36px rgba(0, 0, 0, 0.4),
    0 4px 10px rgba(0, 0, 0, 0.3);
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
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.25);
}

.yard-slot {
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  display: grid;
  place-items: center;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.25);
}

/* Center */
.center {
  grid-row: 7 / 10;
  grid-column: 7 / 10;
  position: relative;
  background: #fdfaf3;
  box-shadow:
    inset 0 3px 6px rgba(255, 255, 255, 0.35),
    inset 0 -4px 8px rgba(0, 0, 0, 0.35);
}

/* 4 solid triangles meeting at the exact center point -- the classic
   Ludo "home" pinwheel, rather than a soft conic-gradient blend. */
.center-triangle {
  position: absolute;
  inset: 0;
}

.center-triangle-top {
  background: #3aa15c;
  clip-path: polygon(0 0, 100% 0, 50% 50%);
}

.center-triangle-right {
  background: #e8b93e;
  clip-path: polygon(100% 0, 100% 100%, 50% 50%);
}

.center-triangle-bottom {
  background: #3f6fd1;
  clip-path: polygon(100% 100%, 0 100%, 50% 50%);
}

.center-triangle-left {
  background: #e33e3e;
  clip-path: polygon(0 100%, 0 0, 50% 50%);
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

/* Entry/"station" squares have a vivid solid background (below), so the
   star needs light-on-dark contrast instead of the default tan-on-cream. */
.track-cell.entry-0.safe::before,
.track-cell.entry-1.safe::before,
.track-cell.entry-2.safe::before,
.track-cell.entry-3.safe::before {
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}

/* Home-stretch corridors: solid, vivid colors -- an actual colored road
   leading from each base to the center, not just a pale tint. */
.lane-0 {
  background: #e33e3e;
}
.lane-1 {
  background: #3aa15c;
}
.lane-2 {
  background: #e8b93e;
}
.lane-3 {
  background: #3f6fd1;
}

/* Entry "station" -- the one ring square each color's tokens actually
   leave the yard onto, colored just as vividly as its lane/yard. */
.entry-0 {
  background: #e33e3e;
}
.entry-1 {
  background: #3aa15c;
}
.entry-2 {
  background: #e8b93e;
}
.entry-3 {
  background: #3f6fd1;
}

/* Overlay grid holding every on-track token, aligned cell-for-cell with
   .ludo-board so a token's gridRow/gridColumn match its real board cell. */
.tokens-layer {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--grid-size), 1fr);
  grid-template-rows: repeat(var(--grid-size), 1fr);
  pointer-events: none;
}

.tokens-layer .token {
  pointer-events: auto;
}

.token-move-move {
  transition: transform 0.35s ease;
}

.token-move-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.token-move-leave-to {
  opacity: 0;
  transform: scale(0.4);
}

/* Overlay grid holding destination-preview dots, aligned the same way as
   .tokens-layer. */
.dots-layer {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--grid-size), 1fr);
  grid-template-rows: repeat(var(--grid-size), 1fr);
  pointer-events: none;
}

.move-dot {
  pointer-events: auto;
  place-self: center;
  width: 40%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2px dashed rgba(0, 0, 0, 0.55);
  opacity: 0.6;
  padding: 0;
  /* No cursor override here -- falls through to the global big blue
     button cursor (style.css) instead of a plain system pointer. */
  animation: dot-pulse 1s ease-in-out infinite;
}

.move-dot:hover {
  opacity: 0.9;
}

.dot-fade-enter-active,
.dot-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.dot-fade-enter-from,
.dot-fade-leave-to {
  opacity: 0;
  transform: scale(0.4);
}

@keyframes dot-pulse {
  0%,
  100% {
    transform: scale(0.85);
  }
  50% {
    transform: scale(1.05);
  }
}

/* Tokens: styled like a glossy chess/checkers piece -- a raised button
   with a light highlight near the top and a darkened rim, rather than a
   flat color disc. */
.token {
  position: relative;
  width: 68%;
  aspect-ratio: 1;
  border-radius: 50%;
  box-shadow:
    0 3px 5px rgba(0, 0, 0, 0.5),
    inset 0 -5px 7px rgba(0, 0, 0, 0.4),
    inset 0 3px 4px rgba(255, 255, 255, 0.45);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  padding: 0;
  animation: pop-in 0.2s ease-out;
  overflow: hidden;
}

.token::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 32% 26%,
    rgba(255, 255, 255, 0.85),
    rgba(255, 255, 255, 0.12) 45%,
    transparent 65%
  );
  pointer-events: none;
}

.track-token {
  position: absolute;
  inset: 10%;
  width: auto;
  height: auto;
}

.token.selectable {
  box-shadow:
    0 0 0 3px rgba(168, 85, 247, 0.7),
    0 3px 6px rgba(0, 0, 0, 0.5),
    inset 0 -5px 7px rgba(0, 0, 0, 0.4),
    inset 0 3px 4px rgba(255, 255, 255, 0.45);
  animation:
    pop-in 0.2s ease-out,
    token-shake 0.5s ease-in-out infinite;
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

/* Only the tokens you can actually choose from right now shake -- since
   .selectable is already gated to that exact set (see canSelectNow /
   myTokenIds above), this naturally never touches other players' or
   your own non-choosable tokens. */
@keyframes token-shake {
  0%,
  100% {
    transform: translateX(0) rotate(0deg);
  }
  20% {
    transform: translateX(-3px) rotate(-6deg);
  }
  40% {
    transform: translateX(3px) rotate(6deg);
  }
  60% {
    transform: translateX(-2px) rotate(-4deg);
  }
  80% {
    transform: translateX(2px) rotate(4deg);
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
  border: 1px solid rgba(0, 0, 0, 0.35);
  box-shadow:
    inset 0 -2px 2px rgba(0, 0, 0, 0.35),
    inset 0 1px 1px rgba(255, 255, 255, 0.5);
}

.player-row {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
  transition: background 0.2s ease;
}

.player-row-active {
  background: rgba(147, 51, 234, 0.18);
}

.choose-hint {
  margin-top: 0.75rem;
  text-align: center;
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
