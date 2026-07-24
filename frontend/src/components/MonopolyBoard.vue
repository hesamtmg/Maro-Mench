<script setup lang="ts">
import { computed } from "vue";
import {
  BOARD,
  GROUP_COLORS,
  HOTEL_LEVEL,
  iconFor,
} from "./monopoly/board-config";
import type { RoomPlayer } from "../types";

const props = defineProps<{
  boardState: Record<string, unknown>;
  players: RoomPlayer[];
  currentTurnSeat: number | null;
  mySeatIndex: number | null;
  hidePlayerSummary?: boolean;
}>();

defineEmits<{
  "buy-decision": [buy: boolean];
  "build-house": [spaceIndex: number];
  "pay-jail-fine": [];
}>();

interface MonopolyPlayerStateShape {
  cash: number;
  position: number;
  inJail: boolean;
  bankrupt: boolean;
}

interface MonopolyPropertyStateShape {
  ownerSeat: number | null;
  houses: number;
  mortgaged: boolean;
}

interface MonopolyStateShape {
  players: Record<number, MonopolyPlayerStateShape>;
  properties: Record<number, MonopolyPropertyStateShape>;
  pendingPurchase: { spaceIndex: number; price: number } | null;
}

const state = computed(
  () => props.boardState as unknown as MonopolyStateShape | null
);

const isMyTurn = computed(
  () => props.mySeatIndex != null && props.mySeatIndex === props.currentTurnSeat
);

const pendingPurchase = computed(() => state.value?.pendingPurchase ?? null);
const pendingSpace = computed(() =>
  pendingPurchase.value ? BOARD[pendingPurchase.value.spaceIndex] : null
);
const pendingBuyerName = computed(() => {
  const seat = props.currentTurnSeat;
  if (seat == null) return "";
  return props.players.find((p) => p.seatIndex === seat)?.displayName ?? "A player";
});

const myPlayerState = computed(() =>
  props.mySeatIndex != null ? state.value?.players?.[props.mySeatIndex] : undefined
);

const buildableProperties = computed(() => {
  const s = state.value;
  const seat = props.mySeatIndex;
  if (!s || seat == null) return [];
  return BOARD.filter((space) => space.type === "property").filter((space) => {
    const prop = s.properties?.[space.index];
    if (!prop || prop.ownerSeat !== seat || prop.mortgaged) return false;
    if ((prop.houses ?? 0) >= HOTEL_LEVEL) return false;
    const siblings = BOARD.filter(
      (o) => o.type === "property" && o.group === space.group
    );
    return siblings.every((o) => s.properties?.[o.index]?.ownerSeat === seat);
  });
});

function playerColor(seatIndex: number | null): string {
  if (seatIndex == null) return "#999";
  return props.players.find((p) => p.seatIndex === seatIndex)?.color ?? "#999";
}

function cashFor(seatIndex: number): number {
  return state.value?.players?.[seatIndex]?.cash ?? 0;
}

function inJailFor(seatIndex: number): boolean {
  return state.value?.players?.[seatIndex]?.inJail ?? false;
}

function bankruptFor(seatIndex: number): boolean {
  return state.value?.players?.[seatIndex]?.bankrupt ?? false;
}

function ownerSeatFor(spaceIndex: number): number | null {
  return state.value?.properties?.[spaceIndex]?.ownerSeat ?? null;
}

function housesFor(spaceIndex: number): number {
  return state.value?.properties?.[spaceIndex]?.houses ?? 0;
}

function playersOn(spaceIndex: number): RoomPlayer[] {
  const s = state.value;
  if (!s) return [];
  return props.players.filter(
    (p) => s.players?.[p.seatIndex]?.position === spaceIndex && !bankruptFor(p.seatIndex)
  );
}

// Standard 11x11 perimeter layout, corners shared between adjacent sides:
// 0 bottom-right -> 10 bottom-left (bottom row) -> 20 top-left (left col)
// -> 30 top-right (top row) -> back to 0 (right col).
function gridPos(index: number): { row: number; col: number } {
  if (index <= 10) return { row: 11, col: 11 - index };
  if (index <= 20) return { row: 21 - index, col: 1 };
  if (index <= 30) return { row: 1, col: index - 19 };
  return { row: index - 29, col: 11 };
}

function cellStyle(index: number) {
  const { row, col } = gridPos(index);
  return { gridRow: String(row), gridColumn: String(col) };
}

function isCorner(index: number): boolean {
  return index === 0 || index === 10 || index === 20 || index === 30;
}
</script>

<template>
  <div class="monopoly-wrap">
    <div class="monopoly-board">
      <div
        v-for="space in BOARD"
        :key="space.index"
        class="ms-cell"
        :class="[`type-${space.type}`, { 'ms-corner': isCorner(space.index) }]"
        :style="[cellStyle(space.index), space.group ? { '--group-color': GROUP_COLORS[space.group] } : {}]"
      >
        <div v-if="space.group" class="ms-swatch" />
        <div v-if="iconFor(space)" class="ms-icon">{{ iconFor(space) }}</div>
        <div class="ms-name">{{ space.name }}</div>
        <div v-if="space.price" class="ms-price">${{ space.price }}</div>
        <div
          v-if="ownerSeatFor(space.index) !== null"
          class="ms-owner-dot"
          :style="{ background: playerColor(ownerSeatFor(space.index)) }"
        />
        <div v-if="housesFor(space.index) > 0" class="ms-houses">
          {{ housesFor(space.index) >= HOTEL_LEVEL ? '🏨' : '🏠'.repeat(housesFor(space.index)) }}
        </div>
        <div v-if="playersOn(space.index).length" class="ms-tokens">
          <span
            v-for="p in playersOn(space.index)"
            :key="p.userId"
            class="ms-token"
            :style="{ background: p.color ?? '#999' }"
            :title="p.displayName"
          />
        </div>
      </div>

      <div class="ms-center">
        <div v-if="!hidePlayerSummary" class="ms-players">
          <div
            v-for="p in players"
            :key="p.userId"
            class="ms-player-row"
            :class="{ 'ms-player-active': p.seatIndex === currentTurnSeat }"
          >
            <span class="color-dot" :style="{ background: p.color ?? '#4f46e5' }" />
            <strong>{{ p.displayName }}</strong>
            <span class="text-muted">${{ cashFor(p.seatIndex) }}</span>
            <span v-if="bankruptFor(p.seatIndex)" class="text-muted">💸</span>
            <span v-else-if="inJailFor(p.seatIndex)" class="text-muted">🚔</span>
          </div>
        </div>

        <div v-if="pendingPurchase && isMyTurn" class="ms-action card">
          <p>
            Buy <strong>{{ pendingSpace?.name }}</strong> for ${{ pendingPurchase.price }}?
          </p>
          <div class="row">
            <button class="btn btn-primary" @click="$emit('buy-decision', true)">
              Buy
            </button>
            <button class="btn btn-secondary" @click="$emit('buy-decision', false)">
              Pass
            </button>
          </div>
        </div>
        <div v-else-if="pendingPurchase" class="ms-action card">
          <p class="text-muted">
            Waiting for {{ pendingBuyerName }} to decide on {{ pendingSpace?.name }}…
          </p>
        </div>

        <div v-if="isMyTurn && !pendingPurchase && myPlayerState?.inJail" class="ms-action card">
          <p class="text-muted">You're in jail.</p>
          <button class="btn btn-secondary" @click="$emit('pay-jail-fine')">
            Pay $50 to get out
          </button>
        </div>

        <div
          v-if="isMyTurn && !pendingPurchase && buildableProperties.length"
          class="ms-action card"
        >
          <p class="text-muted">Build a house:</p>
          <div class="ms-build-list">
            <button
              v-for="space in buildableProperties"
              :key="space.index"
              class="btn btn-secondary ms-build-btn"
              @click="$emit('build-house', space.index)"
            >
              {{ space.name }} (${{ space.houseCost }})
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monopoly-wrap {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}

.monopoly-board {
  display: grid;
  grid-template-columns: repeat(11, 1fr);
  grid-template-rows: repeat(11, 1fr);
  gap: 2px;
  aspect-ratio: 1;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}

.ms-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  background: var(--color-surface);
  padding: 2px 1px;
  overflow: hidden;
  text-align: center;
}

.ms-swatch {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 18%;
  background: var(--group-color, transparent);
}

.ms-icon {
  font-size: clamp(0.6rem, 1.4vw, 0.95rem);
  line-height: 1;
}

.ms-name {
  font-size: clamp(0.4rem, 0.85vw, 0.62rem);
  line-height: 1.1;
  color: var(--color-text);
  word-break: break-word;
}

.ms-price {
  font-size: clamp(0.35rem, 0.75vw, 0.55rem);
  color: var(--color-text-muted);
}

.ms-corner .ms-name {
  font-size: clamp(0.45rem, 1vw, 0.7rem);
  font-weight: 700;
}

.ms-owner-dot {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
}

.ms-houses {
  font-size: clamp(0.4rem, 0.9vw, 0.6rem);
  line-height: 1;
}

.ms-tokens {
  display: flex;
  gap: 1px;
  flex-wrap: wrap;
  justify-content: center;
}

.ms-token {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.ms-center {
  grid-row: 2 / 11;
  grid-column: 2 / 11;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem;
  overflow-y: auto;
}

.ms-players {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ms-player-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius);
  font-size: 0.8rem;
}

.ms-player-active {
  background: rgba(147, 51, 234, 0.18);
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ms-action {
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
}

.ms-action p {
  margin: 0 0 0.4rem;
}

.ms-build-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ms-build-btn {
  font-size: 0.75rem;
  padding: 0.35rem 0.6rem;
  text-align: left;
}

@media (max-width: 640px) {
  .ms-name,
  .ms-price {
    display: none;
  }
  .ms-corner .ms-name {
    display: block;
  }
}
</style>
