<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  BOARD,
  GROUP_COLORS,
  HOTEL_LEVEL,
  backgroundStyleFor,
  iconFor,
  tokenIconForSeat,
} from "./monopoly/board-config";
import type { MonopolySpace } from "./monopoly/board-config";
import type { RoomPlayer } from "../types";

const props = defineProps<{
  boardState: Record<string, unknown>;
  players: RoomPlayer[];
  currentTurnSeat: number | null;
  mySeatIndex: number | null;
  hidePlayerSummary?: boolean;
  // Most recent Chance/Community Chest draw, for the full-board reveal
  // overlay below. `id` is a unique counter so the watcher can tell a
  // fresh draw apart from the same card text coming up twice in a row.
  lastCard?: { deck: 'chance' | 'chest'; text: string; id: number } | null;
}>();

const emit = defineEmits<{
  "buy-decision": [buy: boolean];
  "build-house": [spaceIndex: number];
  "sell-house": [spaceIndex: number];
  "mortgage": [spaceIndex: number];
  "unmortgage": [spaceIndex: number];
  "pay-jail-fine": [];
  "pay-debt": [];
  "declare-bankruptcy": [];
  "place-bid": [amount: number];
  "pass-auction": [];
  "propose-trade": [
    offer: {
      toSeat: number;
      offerCash: number;
      offerProperties: number[];
      offerJailCards: number;
      requestCash: number;
      requestProperties: number[];
      requestJailCards: number;
    },
  ];
  "respond-trade": [tradeId: string, accept: boolean];
}>();

interface MonopolyPlayerStateShape {
  cash: number;
  position: number;
  inJail: boolean;
  bankrupt: boolean;
  jailFreeCards: number;
}

interface MonopolyPropertyStateShape {
  ownerSeat: number | null;
  houses: number;
  mortgaged: boolean;
}

interface MonopolyAuctionStateShape {
  spaceIndex: number;
  highestBid: number;
  highestBidderSeat: number | null;
  activeBidders: number[];
  currentBidderSeat: number;
  originSeat: number;
}

interface MonopolyTradeOfferShape {
  id: string;
  fromSeat: number;
  toSeat: number;
  offerCash: number;
  offerProperties: number[];
  offerJailCards: number;
  requestCash: number;
  requestProperties: number[];
  requestJailCards: number;
}

interface MonopolyPendingDebtShape {
  amount: number;
  payeeSeat: number | null;
  reason: 'rent' | 'tax' | 'card' | 'jail_fine';
}

interface MonopolyStateShape {
  players: Record<number, MonopolyPlayerStateShape>;
  properties: Record<number, MonopolyPropertyStateShape>;
  pendingPurchase: { spaceIndex: number; price: number } | null;
  auction: MonopolyAuctionStateShape | null;
  pendingDebt: MonopolyPendingDebtShape | null;
  trades: MonopolyTradeOfferShape[];
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

const pendingDebt = computed(() => state.value?.pendingDebt ?? null);
const canPayDebt = computed(
  () => pendingDebt.value != null && (myPlayerState.value?.cash ?? 0) >= pendingDebt.value.amount
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
    if (!siblings.every((o) => s.properties?.[o.index]?.ownerSeat === seat)) return false;
    // Even-build rule (mirrors the backend): can't build ahead of the
    // group's least-built property.
    const minHouses = Math.min(...siblings.map((o) => s.properties?.[o.index]?.houses ?? 0));
    return (prop.houses ?? 0) <= minHouses;
  });
});

function mortgageValueFor(price: number | undefined): number {
  return Math.floor((price ?? 0) / 2);
}

function unmortgageCostFor(price: number | undefined): number {
  const value = mortgageValueFor(price);
  return value + Math.ceil(value * 0.1);
}

// --- Title deed card (click any owned/ownable space to see it) ---

const selectedDeed = ref<MonopolySpace | null>(null);

function openDeed(space: MonopolySpace) {
  if (space.price == null) return;
  selectedDeed.value = space;
}

function closeDeed() {
  selectedDeed.value = null;
}

const ownedSpaceTypes = new Set(["property", "transit", "utility"]);

const sellableProperties = computed(() => {
  const s = state.value;
  const seat = props.mySeatIndex;
  if (!s || seat == null) return [];
  return BOARD.filter((space) => space.type === "property").filter((space) => {
    const prop = s.properties?.[space.index];
    if (!prop || prop.ownerSeat !== seat || (prop.houses ?? 0) <= 0) return false;
    const siblings = BOARD.filter(
      (o) => o.type === "property" && o.group === space.group
    );
    const maxHouses = Math.max(...siblings.map((o) => s.properties?.[o.index]?.houses ?? 0));
    return prop.houses >= maxHouses;
  });
});

const mortgageableProperties = computed(() => {
  const s = state.value;
  const seat = props.mySeatIndex;
  if (!s || seat == null) return [];
  return BOARD.filter((space) => ownedSpaceTypes.has(space.type)).filter((space) => {
    const prop = s.properties?.[space.index];
    return prop && prop.ownerSeat === seat && !prop.mortgaged && (prop.houses ?? 0) === 0;
  });
});

const mortgagedProperties = computed(() => {
  const s = state.value;
  const seat = props.mySeatIndex;
  if (!s || seat == null) return [];
  return BOARD.filter((space) => ownedSpaceTypes.has(space.type)).filter((space) => {
    const prop = s.properties?.[space.index];
    return prop && prop.ownerSeat === seat && prop.mortgaged;
  });
});

function nameForSeat(seatIndex: number | null): string {
  if (seatIndex == null) return "A player";
  return props.players.find((p) => p.seatIndex === seatIndex)?.displayName ?? "A player";
}

// --- Auction ---

const auction = computed(() => state.value?.auction ?? null);
const auctionSpace = computed(() =>
  auction.value ? BOARD[auction.value.spaceIndex] : null
);
const isMyBidTurn = computed(
  () => auction.value != null && props.mySeatIndex === auction.value.currentBidderSeat
);
const iAmHighestBidder = computed(
  () => auction.value != null && props.mySeatIndex === auction.value.highestBidderSeat
);
const minNextBid = computed(() => (auction.value?.highestBid ?? 0) + 1);
const bidAmount = ref(minNextBid.value);
watch(minNextBid, (v) => {
  if (bidAmount.value < v) bidAmount.value = v;
});

function submitBid() {
  emit("place-bid", Math.max(minNextBid.value, Math.floor(bidAmount.value)));
}

// --- Trading ---

const tradeableSpaceTypes = new Set(["property", "transit", "utility"]);

function tradeablePropertiesFor(seatIndex: number) {
  const s = state.value;
  if (!s) return [];
  return BOARD.filter((space) => tradeableSpaceTypes.has(space.type)).filter((space) => {
    const prop = s.properties?.[space.index];
    return prop && prop.ownerSeat === seatIndex && !prop.mortgaged && (prop.houses ?? 0) === 0;
  });
}

function jailCardsFor(seatIndex: number | null): number {
  if (seatIndex == null) return 0;
  return state.value?.players?.[seatIndex]?.jailFreeCards ?? 0;
}

const otherActivePlayers = computed(() =>
  props.players.filter((p) => p.seatIndex !== props.mySeatIndex && !bankruptFor(p.seatIndex))
);

const trades = computed(() => state.value?.trades ?? []);
const myTrades = computed(() =>
  trades.value.filter(
    (t) => t.fromSeat === props.mySeatIndex || t.toSeat === props.mySeatIndex
  )
);

function tradeSummary(trade: MonopolyTradeOfferShape): string {
  const offerParts = [
    trade.offerCash > 0 ? `$${trade.offerCash}` : "",
    ...trade.offerProperties.map((i) => BOARD[i].name),
    trade.offerJailCards > 0 ? `${trade.offerJailCards}x jail card` : "",
  ].filter(Boolean);
  const requestParts = [
    trade.requestCash > 0 ? `$${trade.requestCash}` : "",
    ...trade.requestProperties.map((i) => BOARD[i].name),
    trade.requestJailCards > 0 ? `${trade.requestJailCards}x jail card` : "",
  ].filter(Boolean);
  return `${nameForSeat(trade.fromSeat)} offers ${offerParts.join(", ") || "nothing"} for ${
    requestParts.join(", ") || "nothing"
  } from ${nameForSeat(trade.toSeat)}`;
}

const showTradeForm = ref(false);
const tradeTargetSeat = ref<number | null>(null);
const offerProperties = ref<number[]>([]);
const requestProperties = ref<number[]>([]);
const offerCash = ref(0);
const requestCash = ref(0);
const offerJailCards = ref(0);
const requestJailCards = ref(0);

const myTradeableProperties = computed(() =>
  props.mySeatIndex != null ? tradeablePropertiesFor(props.mySeatIndex) : []
);
const targetTradeableProperties = computed(() =>
  tradeTargetSeat.value != null ? tradeablePropertiesFor(tradeTargetSeat.value) : []
);

function resetTradeForm() {
  tradeTargetSeat.value = otherActivePlayers.value[0]?.seatIndex ?? null;
  offerProperties.value = [];
  requestProperties.value = [];
  offerCash.value = 0;
  requestCash.value = 0;
  offerJailCards.value = 0;
  requestJailCards.value = 0;
}

function openTradeForm() {
  resetTradeForm();
  showTradeForm.value = true;
}

function submitTrade() {
  if (tradeTargetSeat.value == null) return;
  emit("propose-trade", {
    toSeat: tradeTargetSeat.value,
    offerCash: Math.max(0, Math.floor(offerCash.value)),
    offerProperties: offerProperties.value,
    offerJailCards: Math.max(0, Math.floor(offerJailCards.value)),
    requestCash: Math.max(0, Math.floor(requestCash.value)),
    requestProperties: requestProperties.value,
    requestJailCards: Math.max(0, Math.floor(requestJailCards.value)),
  });
  showTradeForm.value = false;
}

function confirmBankruptcy() {
  if (
    window.confirm(
      "Declare bankruptcy? You'll lose every property and be out of the game -- this can't be undone."
    )
  ) {
    emit("declare-bankruptcy");
  }
}

function confirmMortgage(spaceIndex: number) {
  if (window.confirm(`Mortgage this property for $${mortgageValueFor(BOARD[spaceIndex].price)}?`)) {
    emit("mortgage", spaceIndex);
  }
}

function confirmSellHouse(spaceIndex: number, refund: number) {
  if (window.confirm(`Sell a house on ${BOARD[spaceIndex].name} for $${refund}?`)) {
    emit("sell-house", spaceIndex);
  }
}

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

function mortgagedFor(spaceIndex: number): boolean {
  return state.value?.properties?.[spaceIndex]?.mortgaged ?? false;
}

// --- Player status detail (owned properties, jail state, net worth) ---

const expandedSeat = ref<number | null>(null);

function toggleExpand(seatIndex: number) {
  expandedSeat.value = expandedSeat.value === seatIndex ? null : seatIndex;
}

function jailFreeCardsFor(seatIndex: number): number {
  return state.value?.players?.[seatIndex]?.jailFreeCards ?? 0;
}

function ownedPropertiesFor(seatIndex: number) {
  return BOARD.filter((space) => ownedSpaceTypes.has(space.type) && ownerSeatFor(space.index) === seatIndex).map(
    (space) => ({
      space,
      houses: housesFor(space.index),
      mortgaged: mortgagedFor(space.index),
    })
  );
}

function propertyValueFor(seatIndex: number): number {
  return ownedPropertiesFor(seatIndex).reduce((total, { space, houses, mortgaged }) => {
    if (mortgaged) return total + Math.floor((space.price ?? 0) / 2);
    return total + (space.price ?? 0) + houses * (space.houseCost ?? 0);
  }, 0);
}

function netWorthFor(seatIndex: number): number {
  return cashFor(seatIndex) + propertyValueFor(seatIndex);
}

// Houses/hotels live here instead of cluttering the small tiles on the
// board edge -- one compact list, land name beside its build level.
const buildingsList = computed(() => {
  const s = state.value;
  if (!s) return [];
  return BOARD.filter((space) => housesFor(space.index) > 0).map((space) => ({
    space,
    houses: housesFor(space.index),
    ownerSeat: ownerSeatFor(space.index),
  }));
});

// --- Token movement animation ---
//
// The server only ever tells us the *destination* position of a move, so a
// token would otherwise teleport straight there with no visible feedback
// that a move happened at all. This tracks a "display" position per seat
// that hops one cell at a time toward the real position, so a normal
// dice-driven move visibly walks around the board. Long jumps (Go To Jail,
// "advance to..." cards) are snapped instead of hopped -- walking 20+ cells
// one at a time would just look broken, not intentional.
const BOARD_SIZE = BOARD.length;
const MAX_HOP_DISTANCE = 12; // longest a real two-dice roll can move
const HOP_DURATION_MS = 180;

const displayPosition = ref<Record<number, number>>({});
const animatingSeats = ref<Set<number>>(new Set());
const hopTimers = new Map<number, ReturnType<typeof setInterval>>();

function clearHopTimer(seatIndex: number) {
  const timer = hopTimers.get(seatIndex);
  if (timer) {
    clearInterval(timer);
    hopTimers.delete(seatIndex);
  }
}

function animateMove(seatIndex: number, from: number, to: number) {
  const steps = (to - from + BOARD_SIZE) % BOARD_SIZE;
  clearHopTimer(seatIndex);
  if (steps === 0) return;
  if (steps > MAX_HOP_DISTANCE) {
    displayPosition.value[seatIndex] = to;
    return;
  }

  animatingSeats.value.add(seatIndex);
  let current = from;
  let hopsDone = 0;
  const timer = setInterval(() => {
    current = (current + 1) % BOARD_SIZE;
    hopsDone += 1;
    displayPosition.value[seatIndex] = current;
    if (hopsDone >= steps) {
      clearHopTimer(seatIndex);
      animatingSeats.value.delete(seatIndex);
    }
  }, HOP_DURATION_MS);
  hopTimers.set(seatIndex, timer);
}

watch(
  () => state.value?.players,
  (players, previousPlayers) => {
    if (!players) return;
    for (const seatKey of Object.keys(players)) {
      const seatIndex = Number(seatKey);
      const newPos = players[seatIndex]?.position;
      if (newPos == null) continue;
      const oldPos = previousPlayers?.[seatIndex]?.position;
      if (oldPos == null) {
        displayPosition.value[seatIndex] = newPos;
      } else if (oldPos !== newPos) {
        animateMove(seatIndex, oldPos, newPos);
      }
    }
  },
  { deep: true, immediate: true }
);

// --- Chance/Community Chest reveal ---
//
// Whenever a card is drawn, hide the board behind a full-cover overlay
// showing just the card for 5 seconds -- makes drawing a card feel like
// an actual event instead of a one-line log entry nobody notices.
const CARD_REVEAL_MS = 5000;
const revealCard = ref<{ deck: 'chance' | 'chest'; text: string } | null>(null);
let revealTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.lastCard,
  (card) => {
    if (!card) return;
    if (revealTimer) clearTimeout(revealTimer);
    revealCard.value = { deck: card.deck, text: card.text };
    revealTimer = setTimeout(() => {
      revealCard.value = null;
    }, CARD_REVEAL_MS);
  }
);

onUnmounted(() => {
  for (const seatIndex of hopTimers.keys()) clearHopTimer(seatIndex);
  if (revealTimer) clearTimeout(revealTimer);
});

function positionFor(seatIndex: number): number | undefined {
  return displayPosition.value[seatIndex] ?? state.value?.players?.[seatIndex]?.position;
}

function isHopping(seatIndex: number): boolean {
  return animatingSeats.value.has(seatIndex);
}

function playersOn(spaceIndex: number): RoomPlayer[] {
  const s = state.value;
  if (!s) return [];
  return props.players.filter(
    (p) => positionFor(p.seatIndex) === spaceIndex && !bankruptFor(p.seatIndex)
  );
}

// Occupied cells get a faded wash of the occupant's color (multiple
// occupants split it into stripes) so it's obvious at a glance which cell
// a player is standing on, with their token icon still legible on top.
function occupantTint(spaceIndex: number): string | null {
  const occupants = playersOn(spaceIndex);
  if (!occupants.length) return null;
  const colors = occupants.map((p) => playerColor(p.seatIndex));
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  const stops = colors
    .map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`)
    .join(", ");
  return `linear-gradient(135deg, ${stops})`;
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

// Classic Monopoly art puts each property's color band on the edge that
// faces *away* from the center (the board's outer rim), not always on
// top -- e.g. the bottom row's band sits at the very bottom of the tile.
function swatchSide(index: number): 'top' | 'bottom' | 'left' | 'right' {
  const { row, col } = gridPos(index);
  // Band faces the *inner* track (toward the center), like the printed
  // board -- e.g. the bottom row's band sits at the top of the tile.
  if (row === 11) return 'top';
  if (col === 1) return 'right';
  if (row === 1) return 'bottom';
  return 'left';
}
</script>

<template>
  <div class="monopoly-wrap">
    <div class="monopoly-board">
      <div
        v-for="space in BOARD"
        :key="space.index"
        class="ms-cell"
        :class="[
          space.group ? `ms-cell-band-${swatchSide(space.index)}` : '',
          {
            'ms-corner': isCorner(space.index),
            'ms-mortgaged': mortgagedFor(space.index),
            'ms-cell-clickable': space.price != null,
          },
        ]"
        :style="[
          cellStyle(space.index),
          space.group ? { '--group-color': GROUP_COLORS[space.group] } : {},
          backgroundStyleFor(space) ?? {},
        ]"
        @click="openDeed(space)"
      >
        <div
          v-if="occupantTint(space.index)"
          class="ms-occupied-tint"
          :style="{ background: occupantTint(space.index) || undefined }"
        />
        <div v-if="mortgagedFor(space.index)" class="ms-mortgaged-badge">M</div>
        <div
          v-if="space.group"
          class="ms-swatch"
          :class="`ms-swatch-${swatchSide(space.index)}`"
        />
        <template v-if="isCorner(space.index)">
          <!-- Bespoke art for the four corners, matching the reference
               board photo, instead of the generic icon+name layout. -->
          <div v-if="space.type === 'go'" class="ms-corner-go">
            <span class="ms-corner-go-arrow">➤</span>
            <span class="ms-corner-go-word">GO</span>
            <span class="ms-corner-go-caption">COLLECT $200</span>
          </div>

          <div v-else-if="space.type === 'jail'" class="ms-corner-jail">
            <div class="ms-corner-jail-cell">
              <span class="ms-corner-jail-icon">🔒</span>
              <span class="ms-corner-jail-label">IN JAIL</span>
            </div>
            <div class="ms-corner-jail-visiting">
              <span class="ms-corner-jail-arrow">↙</span>
              <span class="ms-corner-jail-label">JUST VISITING</span>
            </div>
          </div>

          <div v-else-if="space.type === 'free_parking'" class="ms-corner-parking">
            <span class="ms-corner-parking-badge">🅿️</span>
            <span class="ms-corner-parking-label">FREE PARKING</span>
          </div>

          <div v-else class="ms-corner-gotojail">
            <span class="ms-corner-gotojail-badge">👮</span>
            <span class="ms-corner-gotojail-label">GO TO JAIL</span>
          </div>
        </template>
        <template v-else>
          <div v-if="iconFor(space)" class="ms-icon">{{ iconFor(space) }}</div>
          <div class="ms-name">{{ space.name }}</div>
          <div v-if="space.price" class="ms-price">${{ space.price }}</div>
        </template>
        <div
          v-if="housesFor(space.index) > 0"
          class="ms-buildings-row"
          :class="`ms-buildings-row-${swatchSide(space.index)}`"
        >
          <span
            v-if="housesFor(space.index) >= HOTEL_LEVEL"
            class="ms-building ms-building-hotel"
          />
          <span
            v-for="n in housesFor(space.index) >= HOTEL_LEVEL ? 0 : housesFor(space.index)"
            :key="n"
            class="ms-building"
          />
        </div>
        <div v-if="ownerSeatFor(space.index) !== null" class="ms-owner-dot">
          <img :src="tokenIconForSeat(ownerSeatFor(space.index) ?? 0)" alt="" />
        </div>
        <div v-if="playersOn(space.index).length" class="ms-tokens">
          <span
            v-for="p in playersOn(space.index)"
            :key="p.userId"
            class="ms-token"
            :class="{ 'ms-token-hopping': isHopping(p.seatIndex) }"
            :title="p.displayName"
          ><img :src="tokenIconForSeat(p.seatIndex)" alt="" /></span>
        </div>
      </div>

      <div class="ms-center">
        <!-- Decorative center art, like the printed board's big diagonal
             wordmark and Chance/Community Chest decks -- purely visual
             (z-index: -1, sits behind every real panel), just filling
             the empty center. -->
        <div class="ms-center-wordmark" aria-hidden="true">MONOPOLY</div>
        <div class="ms-center-card ms-center-card-chance" aria-hidden="true">
          <span class="ms-center-card-mark">?</span>
          <span class="ms-center-card-label">Chance</span>
        </div>
        <div class="ms-center-card ms-center-card-chest" aria-hidden="true">
          <span class="ms-center-card-mark">🎁</span>
          <span class="ms-center-card-label">Community Chest</span>
        </div>

        <div v-if="!hidePlayerSummary" class="ms-players">
          <div v-for="p in players" :key="p.userId" class="ms-player-block">
            <div
              class="ms-player-row"
              :class="{ 'ms-player-active': p.seatIndex === currentTurnSeat }"
              role="button"
              tabindex="0"
              @click="toggleExpand(p.seatIndex)"
              @keydown.enter="toggleExpand(p.seatIndex)"
            >
              <span class="color-dot"><img :src="tokenIconForSeat(p.seatIndex)" alt="" /></span>
              <strong>{{ p.displayName }}</strong>
              <span class="text-muted">${{ cashFor(p.seatIndex) }}</span>
              <span v-if="bankruptFor(p.seatIndex)" class="text-muted">💸</span>
              <span v-else-if="inJailFor(p.seatIndex)" class="text-muted">🚔</span>
              <span class="ms-expand-caret">{{ expandedSeat === p.seatIndex ? '▲' : '▼' }}</span>
            </div>

            <div v-if="expandedSeat === p.seatIndex" class="ms-player-detail">
              <div class="ms-detail-stats">
                <span>💵 ${{ cashFor(p.seatIndex) }}</span>
                <span>📊 Net worth: ${{ netWorthFor(p.seatIndex) }}</span>
                <span>
                  🪪
                  {{
                    bankruptFor(p.seatIndex)
                      ? "Bankrupt"
                      : inJailFor(p.seatIndex)
                        ? "In jail"
                        : "Free"
                  }}
                </span>
                <span v-if="jailFreeCardsFor(p.seatIndex) > 0">
                  🎟️ {{ jailFreeCardsFor(p.seatIndex) }}x Get Out of Jail Free
                </span>
              </div>

              <p v-if="!ownedPropertiesFor(p.seatIndex).length" class="text-muted ms-no-properties">
                Owns no properties yet.
              </p>
              <ul v-else class="ms-owned-list">
                <li
                  v-for="{ space, houses, mortgaged } in ownedPropertiesFor(p.seatIndex)"
                  :key="space.index"
                  class="ms-owned-item"
                >
                  <span
                    v-if="space.group"
                    class="ms-owned-swatch"
                    :style="{ background: GROUP_COLORS[space.group] }"
                  />
                  <span class="ms-owned-name">{{ space.name }}</span>
                  <span v-if="houses > 0" class="ms-owned-houses">
                    <span v-if="houses >= HOTEL_LEVEL" class="ms-building ms-building-hotel" />
                    <span v-for="i in houses >= HOTEL_LEVEL ? 0 : houses" :key="i" class="ms-building" />
                  </span>
                  <span v-if="mortgaged" class="ms-owned-mortgaged">Mortgaged</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div v-if="buildingsList.length" class="ms-action card ms-buildings">
          <p class="text-muted">🏠 Buildings</p>
          <ul class="ms-owned-list">
            <li
              v-for="{ space, houses, ownerSeat } in buildingsList"
              :key="space.index"
              class="ms-owned-item"
            >
              <span
                v-if="space.group"
                class="ms-owned-swatch"
                :style="{ background: GROUP_COLORS[space.group] }"
              />
              <span class="ms-owned-name">{{ space.name }}</span>
              <span class="ms-owned-houses">
                <span v-if="houses >= HOTEL_LEVEL" class="ms-building ms-building-hotel" />
                <span v-for="i in houses >= HOTEL_LEVEL ? 0 : houses" :key="i" class="ms-building" />
              </span>
              <span class="text-muted ms-owned-by">{{ nameForSeat(ownerSeat) }}</span>
            </li>
          </ul>
        </div>

        <div v-if="auction" class="ms-action card ms-auction">
          <p>
            🔨 Auction: <strong>{{ auctionSpace?.name }}</strong> -- highest bid
            <strong>${{ auction.highestBid }}</strong>
            <template v-if="auction.highestBidderSeat != null">
              by {{ nameForSeat(auction.highestBidderSeat) }}
            </template>
          </p>
          <div v-if="isMyBidTurn" class="row">
            <input
              v-model.number="bidAmount"
              type="number"
              :min="minNextBid"
              class="ms-bid-input"
            />
            <button class="btn btn-primary" @click="submitBid">Bid</button>
            <button
              class="btn btn-secondary"
              :disabled="iAmHighestBidder"
              @click="$emit('pass-auction')"
            >
              Pass
            </button>
          </div>
          <p v-else class="text-muted">
            Waiting for {{ nameForSeat(auction.currentBidderSeat) }} to bid…
          </p>
        </div>

        <div v-if="pendingDebt" class="ms-action card ms-debt">
          <p>
            ⚠️ <strong>{{ isMyTurn ? "You owe" : `${nameForSeat(currentTurnSeat)} owes` }}
            ${{ pendingDebt.amount }}</strong>
            <template v-if="pendingDebt.payeeSeat != null">
              to {{ nameForSeat(pendingDebt.payeeSeat) }}
            </template>
            and can't cover it.
          </p>
          <template v-if="isMyTurn">
            <p class="text-muted">Mortgage a property or sell a house to raise cash.</p>
            <div class="row">
              <button
                class="btn btn-primary"
                :disabled="!canPayDebt"
                @click="$emit('pay-debt')"
              >
                Pay debt
              </button>
              <button class="btn btn-danger" @click="confirmBankruptcy">
                Declare bankruptcy
              </button>
            </div>
          </template>
          <p v-else class="text-muted">Waiting for them to resolve it…</p>
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

        <div v-if="isMyTurn && !pendingPurchase && !auction && myPlayerState?.inJail" class="ms-action card">
          <p class="text-muted">You're in jail.</p>
          <button class="btn btn-secondary" @click="$emit('pay-jail-fine')">
            Pay $50 to get out
          </button>
        </div>

        <div
          v-if="isMyTurn && !pendingPurchase && !auction && !pendingDebt && buildableProperties.length"
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

        <div
          v-if="isMyTurn && !pendingPurchase && !auction && sellableProperties.length"
          class="ms-action card"
        >
          <p class="text-muted">Sell a house:</p>
          <div class="ms-build-list">
            <button
              v-for="space in sellableProperties"
              :key="space.index"
              class="btn btn-secondary ms-build-btn"
              @click="confirmSellHouse(space.index, Math.floor((space.houseCost ?? 0) / 2))"
            >
              {{ space.name }} (+${{ Math.floor((space.houseCost ?? 0) / 2) }})
            </button>
          </div>
        </div>

        <div
          v-if="isMyTurn && !pendingPurchase && !auction && mortgageableProperties.length"
          class="ms-action card"
        >
          <p class="text-muted">Mortgage for cash:</p>
          <div class="ms-build-list">
            <button
              v-for="space in mortgageableProperties"
              :key="space.index"
              class="btn btn-secondary ms-build-btn"
              @click="confirmMortgage(space.index)"
            >
              {{ space.name }} (+${{ mortgageValueFor(space.price) }})
            </button>
          </div>
        </div>

        <div
          v-if="isMyTurn && !pendingPurchase && !auction && mortgagedProperties.length"
          class="ms-action card"
        >
          <p class="text-muted">Pay off a mortgage:</p>
          <div class="ms-build-list">
            <button
              v-for="space in mortgagedProperties"
              :key="space.index"
              class="btn btn-secondary ms-build-btn"
              @click="$emit('unmortgage', space.index)"
            >
              {{ space.name }} (-${{ unmortgageCostFor(space.price) }})
            </button>
          </div>
        </div>

        <div v-if="myTrades.length" class="ms-action card">
          <p class="text-muted">Trade offers:</p>
          <div class="ms-trade-list">
            <div v-for="trade in myTrades" :key="trade.id" class="ms-trade-row">
              <span>{{ tradeSummary(trade) }}</span>
              <div class="row">
                <button
                  v-if="trade.toSeat === mySeatIndex"
                  class="btn btn-primary ms-trade-btn"
                  @click="$emit('respond-trade', trade.id, true)"
                >
                  Accept
                </button>
                <button
                  class="btn btn-secondary ms-trade-btn"
                  @click="$emit('respond-trade', trade.id, false)"
                >
                  {{ trade.toSeat === mySeatIndex ? "Decline" : "Cancel" }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!auction && otherActivePlayers.length" class="ms-action card">
          <button
            v-if="!showTradeForm"
            class="btn btn-secondary ms-trade-toggle"
            @click="openTradeForm"
          >
            Propose a trade
          </button>

          <div v-else class="ms-trade-form">
            <div class="form-group">
              <label>Trade with</label>
              <select v-model.number="tradeTargetSeat">
                <option
                  v-for="p in otherActivePlayers"
                  :key="p.userId"
                  :value="p.seatIndex"
                >
                  {{ p.displayName }}
                </option>
              </select>
            </div>

            <div class="ms-trade-columns">
              <div class="ms-trade-col">
                <p class="text-muted">You give</p>
                <label class="ms-inline-label">
                  Cash <input v-model.number="offerCash" type="number" min="0" />
                </label>
                <label class="ms-inline-label">
                  Jail cards
                  <input
                    v-model.number="offerJailCards"
                    type="number"
                    min="0"
                    :max="jailCardsFor(mySeatIndex)"
                  />
                </label>
                <div class="ms-trade-props">
                  <label v-for="space in myTradeableProperties" :key="space.index">
                    <input
                      type="checkbox"
                      :value="space.index"
                      v-model="offerProperties"
                    />
                    {{ space.name }}
                  </label>
                </div>
              </div>

              <div class="ms-trade-col">
                <p class="text-muted">You get</p>
                <label class="ms-inline-label">
                  Cash <input v-model.number="requestCash" type="number" min="0" />
                </label>
                <label class="ms-inline-label">
                  Jail cards
                  <input
                    v-model.number="requestJailCards"
                    type="number"
                    min="0"
                    :max="jailCardsFor(tradeTargetSeat)"
                  />
                </label>
                <div class="ms-trade-props">
                  <label v-for="space in targetTradeableProperties" :key="space.index">
                    <input
                      type="checkbox"
                      :value="space.index"
                      v-model="requestProperties"
                    />
                    {{ space.name }}
                  </label>
                </div>
              </div>
            </div>

            <div class="row">
              <button
                class="btn btn-primary"
                :disabled="tradeTargetSeat == null"
                @click="submitTrade"
              >
                Send offer
              </button>
              <button class="btn btn-secondary" @click="showTradeForm = false">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Full-board reveal: hides everything else for a few seconds so
           drawing a card actually feels like an event. -->
      <div
        v-if="revealCard"
        class="ms-card-reveal-overlay"
        :class="`ms-card-reveal-overlay-${revealCard.deck}`"
      >
        <div class="ms-card-reveal">
          <div
            class="ms-card-reveal-header"
            :class="`ms-card-reveal-header-${revealCard.deck}`"
          >
            <span>{{ revealCard.deck === 'chance' ? '❓' : '🎁' }}</span>
            <span>{{ revealCard.deck === 'chance' ? 'Chance' : 'Community Chest' }}</span>
          </div>
          <div class="ms-card-reveal-body">
            <p class="ms-card-reveal-text">{{ revealCard.text }}</p>
          </div>
        </div>
      </div>

      <!-- Title deed card: click any property/station/utility to see it,
           like picking up its printed card off the board. -->
      <div v-if="selectedDeed" class="ms-deed-overlay" @click.self="closeDeed">
        <div class="ms-deed-card">
          <div
            class="ms-deed-header"
            :style="{
              background: selectedDeed.group
                ? GROUP_COLORS[selectedDeed.group]
                : selectedDeed.type === 'transit'
                  ? '#1c1710'
                  : '#c9a227',
            }"
          />
          <div class="ms-deed-body">
            <p class="ms-deed-label">Title Deed</p>
            <p class="ms-deed-name">{{ selectedDeed.name }}</p>

            <template v-if="selectedDeed.type === 'property' && selectedDeed.rent">
              <div class="ms-deed-row"><span>Rent</span><span>${{ selectedDeed.rent[0] }}</span></div>
              <div v-for="n in 4" :key="`rent-house-${n}`" class="ms-deed-row">
                <span class="ms-deed-rent-label">
                  Rent with
                  <span class="ms-deed-icons">
                    <span v-for="i in n" :key="i" class="ms-building" />
                  </span>
                </span>
                <span>${{ selectedDeed.rent[n] }}</span>
              </div>
              <div class="ms-deed-row">
                <span class="ms-deed-rent-label">
                  Rent with
                  <span class="ms-deed-icons">
                    <span class="ms-building ms-building-hotel" />
                  </span>
                </span>
                <span>${{ selectedDeed.rent[5] }}</span>
              </div>
              <div class="ms-deed-divider" />
              <div class="ms-deed-row">
                <span>Houses cost</span><span>${{ selectedDeed.houseCost }} each</span>
              </div>
              <div class="ms-deed-row">
                <span>Hotel costs</span><span>${{ selectedDeed.houseCost }} + 4 houses</span>
              </div>
            </template>

            <template v-else-if="selectedDeed.type === 'transit'">
              <p class="ms-deed-note">Rent is $25 if 1 Station is owned.</p>
              <p class="ms-deed-note">Rent is $50 if 2 Stations are owned.</p>
              <p class="ms-deed-note">Rent is $100 if 3 Stations are owned.</p>
              <p class="ms-deed-note">Rent is $200 if all 4 Stations are owned.</p>
            </template>

            <template v-else-if="selectedDeed.type === 'utility'">
              <p class="ms-deed-note">
                If one Utility is owned, rent is 4x the amount shown on the dice.
              </p>
              <p class="ms-deed-note">
                If both Utilities are owned, rent is 10x the amount shown on the dice.
              </p>
            </template>

            <div class="ms-deed-divider" />
            <div class="ms-deed-row"><span>Price</span><span>${{ selectedDeed.price }}</span></div>
            <div class="ms-deed-row">
              <span>Mortgage value</span><span>${{ mortgageValueFor(selectedDeed.price) }}</span>
            </div>

            <button class="btn btn-secondary ms-deed-close" @click="closeDeed">Close</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monopoly-wrap {

  margin: -8dvh auto 3dvh;
 
}

.monopoly-board {
  position: relative;
  display: grid;
  /* Corners (GO, Jail, Free Parking, Go To Jail) stay full-size; the
     ordinary middle tiles run smaller now that houses/hotels no longer
     need to fit on them (see .ms-buildings in the center instead). */
  grid-template-columns: 1.25fr repeat(9, 1fr) 1.25fr;
  grid-template-rows: 1.25fr repeat(9, 1fr) 1.25fr;
  gap: 2px;
  aspect-ratio: 1;
  /* Thin black rule lines between tiles, like the printed grid lines on
     a real board. */
  background: #141110;
  /* Thick frame + layered shadow reads as a solid physical slab rather
     than a flat image: a bright top bevel, a dark under-bevel, and a
     soft ambient shadow floating it off the page. */
  border: 6px solid #1b1710;
  border-radius: calc(var(--radius) + 4px);
  overflow: hidden;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.12),
    inset 0 -3px 6px rgba(0, 0, 0, 0.55),
    0 22px 34px rgba(0, 0, 0, 0.55),
    0 4px 10px rgba(0, 0, 0, 0.4);
  transform: perspective(1600px) rotateX(8deg);
  transform-origin: center bottom;
}

.ms-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  /* Classic board look: a uniform cream/ivory card for every tile --
     properties get their group's identity purely from the color band
     (.ms-swatch) on the outer edge, matching the printed board. */
  background: #f2ecd6;
  padding: 2px 1px;
  overflow: hidden;
  text-align: center;
  /* A soft paper-like bevel instead of the old dark tile shadow. */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    inset 0 -1px 2px rgba(0, 0, 0, 0.15);
}

.ms-cell-clickable {
  cursor: pointer;
}

.ms-corner {
  background: #fbfaf1;
}

/* --- Corner art, matching the reference board photo --- */

.ms-corner-go {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.ms-corner-go-arrow {
  font-size: clamp(1.3rem, 2.8vw, 1.9rem);
  line-height: 1;
  color: #e0392c;
  transform: rotate(135deg);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
}

.ms-corner-go-word {
  font-size: clamp(1.05rem, 2.3vw, 1.5rem);
  font-weight: 800;
  color: #e0392c;
  letter-spacing: 0.02em;
}

.ms-corner-go-caption {
  font-size: clamp(0.38rem, 0.8vw, 0.52rem);
  font-weight: 700;
  color: #1c1710;
}

.ms-corner-jail {
  position: absolute;
  inset: 0;
}

.ms-corner-jail-cell {
  position: absolute;
  top: 0;
  left: 0;
  width: 68%;
  height: 68%;
  clip-path: polygon(0 0, 100% 0, 0 100%);
  background: #e8952f;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 3px 0 0 3px;
}

.ms-corner-jail-icon {
  font-size: clamp(0.7rem, 1.6vw, 1rem);
  line-height: 1;
}

.ms-corner-jail-visiting {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 68%;
  height: 68%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 1px;
  padding: 0 3px 3px 0;
  text-align: right;
}

.ms-corner-jail-arrow {
  font-size: clamp(0.65rem, 1.4vw, 0.9rem);
  line-height: 1;
  color: #1c1710;
}

.ms-corner-jail-label {
  font-size: clamp(0.32rem, 0.7vw, 0.48rem);
  font-weight: 800;
  line-height: 1.1;
  color: #1c1710;
}

.ms-corner-parking,
.ms-corner-gotojail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.ms-corner-parking-badge,
.ms-corner-gotojail-badge {
  font-size: clamp(1.3rem, 2.8vw, 1.9rem);
  line-height: 1;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35));
}

.ms-corner-parking-label {
  font-size: clamp(0.38rem, 0.8vw, 0.52rem);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-align: center;
  color: #c0392b;
}

.ms-corner-gotojail-label {
  font-size: clamp(0.38rem, 0.8vw, 0.52rem);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-align: center;
  color: #1f4fd1;
}

.ms-cell-band-top {
  padding-top: calc(20% + 2px);
}
.ms-cell-band-bottom {
  padding-bottom: calc(20% + 2px);
}
.ms-cell-band-left {
  padding-left: calc(20% + 2px);
}
.ms-cell-band-right {
  padding-right: calc(20% + 2px);
}

/* The property group's color strip -- always on the edge facing away
   from the board's center (see swatchSide()), like the printed board. */
.ms-swatch {
  position: absolute;
  z-index: 1;
  background: var(--group-color, transparent);
}
.ms-swatch-top {
  top: 0;
  left: 0;
  right: 0;
  height: 20%;
}
.ms-swatch-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 20%;
}
.ms-swatch-left {
  top: 0;
  bottom: 0;
  left: 0;
  width: 20%;
}
.ms-swatch-right {
  top: 0;
  bottom: 0;
  right: 0;
  width: 20%;
}

.ms-icon,
.ms-name,
.ms-price {
  position: relative;
  z-index: 1;
}

/* Faded color wash for whichever cell(s) a player is currently standing
   on -- sits between the tile's own background and its text/icons/tokens
   (all bumped to z-index: 1) so the occupant is recognizable at a glance
   without hiding the tile's info. */
.ms-occupied-tint {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.55;
  pointer-events: none;
}

.ms-icon {
  font-size: clamp(0.6rem, 1.4vw, 0.95rem);
  line-height: 1;
}

.ms-name {
  font-size: clamp(0.4rem, 0.85vw, 0.62rem);
  line-height: 1.1;
  color: #1c1710;
  font-weight: 600;
  word-break: break-word;
}

.ms-price {
  font-size: clamp(0.35rem, 0.75vw, 0.55rem);
  color: #4a4030;
}

/* The owner's own token, shown very small, instead of a plain color dot. */
.ms-owner-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  z-index: 1;
  width: 15px;
  height: 15px;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.8));
}

.ms-owner-dot img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* Little green house / red hotel pieces sitting right on the property,
   next to its color band -- like the plastic pieces on a real board,
   instead of only listing them in the side panel. */
.ms-buildings-row {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5px;
  pointer-events: none;
}

.ms-buildings-row-top {
  top: calc(20% + 2px);
  left: 0;
  right: 0;
}

.ms-buildings-row-bottom {
  bottom: calc(20% + 2px);
  left: 0;
  right: 0;
}

.ms-buildings-row-left {
  left: calc(20% + 2px);
  top: 0;
  bottom: 0;
  flex-direction: column;
}

.ms-buildings-row-right {
  right: calc(20% + 2px);
  top: 0;
  bottom: 0;
  flex-direction: column;
}

/* clip-path also clips box-shadow, so the outer drop shadow has to be a
   filter instead (filter is a post-clip effect) -- the inset shadows
   still clip correctly to the house silhouette, giving it a molded
   plastic-piece look rather than a flat sticker. */
.ms-building {
  width: 11px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(160deg, #5fc26b 0%, #1f7a30 100%);
  clip-path: polygon(50% 0%, 100% 40%, 100% 100%, 0% 100%, 0% 40%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.55),
    inset 0 -3px 3px rgba(0, 0, 0, 0.4);
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.55));
}

.ms-building-hotel {
  width: 18px;
  height: 15px;
  background: linear-gradient(160deg, #ef5b4e 0%, #9a231c 100%);
  /* A flat block instead of the house's pitched-roof shape, like the
     real board's distinct hotel piece. */
  clip-path: none;
  border-radius: 2px;
}

.ms-mortgaged {
  opacity: 0.5;
}

.ms-mortgaged-badge {
  position: absolute;
  top: 2px;
  left: 2px;
  z-index: 1;
  font-size: 0.55rem;
  font-weight: 700;
  color: #f87171;
  border: 1px solid #f87171;
  border-radius: 3px;
  padding: 0 2px;
  line-height: 1.2;
}

.ms-tokens {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  justify-content: center;
}

/* Glossy 3D playing piece: a raised colored disc (radial gradient +
   inset highlight/shadow) with the icon sitting on top, echoing the
   chess-button token look used on the Ludo board. */
/* Just the piece itself now, no colored circle backdrop -- a drop
   shadow keeps it grounded against whatever's under it on the board. */
.ms-token {
  width: clamp(26px, 5.6vw, 38px);
  height: clamp(26px, 5.6vw, 38px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ms-token img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6));
}

/* Bounces the token while it's hopping cell-by-cell toward its new
   position, so a move actually reads as motion instead of a silent
   teleport. */
.ms-token-hopping {
  animation: ms-token-hop 0.18s ease-in-out infinite;
}

@keyframes ms-token-hop {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-5px) scale(1.2);
  }
}

.ms-center {
  grid-row: 2 / 11;
  grid-column: 2 / 11;
  position: relative;
  /* position + a real z-index (not auto) is required to actually contain
     the decorative cards' z-index: -1 below -- without it, "relative"
     alone doesn't create a stacking context and they sink out of view,
     behind the grid's own dark grout background instead. */
  z-index: 0;
  /* Mint green, like the printed board's center field -- the app's usual
     dark surface color was designed to sit on a dark page and read as a
     near-black void here against the new cream tiles. */
  background: #cfe8d6;
  color: #1c1710;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem;
  overflow-y: auto;
  /* Explicit, not left to default to visible -- otherwise it needs to be
     auto too, and the decorative wordmark banner (rotated, wider than
     the container) turns that into a real horizontal scrollbar instead
     of just clipping at the edge. */
  overflow-x: hidden;
  /* Grid items default to min-height: auto, which lets tall content (a
     long trade form, a long mortgage list) force the grid ROWS it spans
     to grow to fit -- stretching the whole board out of square and
     pushing every side tile apart instead of just scrolling internally
     the way overflow-y: auto above is supposed to. This is what actually
     needs fixing, not the board itself. */
  min-height: 0;
  min-width: 0;
}

/* .btn-secondary is styled for the app's dark pages (near-transparent
   white on near-transparent white) -- on this board's light cream cards
   (the center panel and the deed card) that's unreadable ghost text, so
   override it locally wherever it shows up on the board. */
.ms-center .btn-secondary,
.ms-deed-card .btn-secondary {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1710;
  border-color: rgba(0, 0, 0, 0.25);
}

.ms-center .btn-secondary:hover:not(:disabled),
.ms-deed-card .btn-secondary:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.12);
}

.ms-center .text-muted {
  color: #4a4030;
}

/* The big diagonal wordmark banner from the printed board's center --
   same NW-SE diagonal as the two card piles below. */
.ms-center-wordmark {
  position: absolute;
  z-index: -1;
  top: 50%;
  left: 50%;
  /* No fixed width -- shrink-wraps to the word itself instead of
     stretching the red banner out to a fraction of the container. */
  width: max-content;
  transform: translate(-50%, -50%) rotate(-35deg);
  text-align: center;
  white-space: nowrap;
  font-family: Arial, Helvetica, sans-serif;
  font-size: clamp(2.1rem, 8.4vw, 4rem);
  font-weight: 900;
  letter-spacing: 0.01em;
  color: #fff;
  /* A thin dark edge on the letters plus a hard drop below, like the
     real logo's slightly embossed white lettering. */
  -webkit-text-stroke: 1px #7a0e12;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.3);
  background: linear-gradient(180deg, #e8281f 0%, #c81a1a 100%);
  border: 3px solid #fdfaf0;
  border-radius: 2px;
  padding: 0.15rem 0.5rem;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.25),
    0 4px 10px rgba(0, 0, 0, 0.4);
}

/* Purely decorative -- echoes the printed board's two diagonal card
   piles in the middle so the center doesn't read as an empty gap
   whenever there's no active auction/trade/etc. panel to show. */
.ms-center-card {
  position: absolute;
  z-index: -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  width: 22%;
  aspect-ratio: 1.5;
  border-radius: 6px;
  border: 2px solid rgba(0, 0, 0, 0.35);
  text-align: center;
  color: #1c1710;
  font-weight: 700;
  /* Both cards run along the same NW-SE diagonal, like the printed
     board's center art, rather than mirroring each other. */
  transform: rotate(-35deg);
}

.ms-center-card-chance {
  top: 14%;
  left: 12%;
  background: #a9d3e8;
  /* Flat offset "peeks" behind the top card fake a stacked deck --
     each one a slightly darker shade standing in for the card beneath. */
  box-shadow:
    3px 3px 0 0 #8bb8d1,
    6px 6px 0 0 #6f9db8,
    0 4px 10px rgba(0, 0, 0, 0.3);
}

.ms-center-card-chest {
  bottom: 14%;
  right: 12%;
  background: #d9b872;
  box-shadow:
    3px 3px 0 0 #c2a15c,
    6px 6px 0 0 #ab8b48,
    0 4px 10px rgba(0, 0, 0, 0.3);
}

.ms-center-card-mark {
  font-size: clamp(1rem, 2.2vw, 1.5rem);
  line-height: 1;
}

.ms-center-card-label {
  font-size: clamp(0.4rem, 0.85vw, 0.55rem);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.ms-players {
  width: 100%;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ms-player-block {
  border-radius: var(--radius);
  overflow: hidden;
}

.ms-player-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius);
  font-size: 0.8rem;
  cursor: pointer;
}

.ms-player-active {
  background: rgba(147, 51, 234, 0.18);
}

.ms-expand-caret {
  margin-left: auto;
  font-size: 0.6rem;
  color: #4a4030;
}

.ms-player-detail {
  padding: 0.4rem 0.5rem 0.6rem 1.8rem;
  font-size: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ms-detail-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.7rem;
  color: #4a4030;
}

.ms-no-properties {
  margin: 0;
}

.ms-owned-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.ms-owned-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.ms-owned-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.ms-owned-name {
  flex: 1;
}

.ms-owned-houses {
  display: inline-flex;
  align-items: center;
  gap: 1.5px;
}

.ms-owned-mortgaged {
  font-size: 0.65rem;
  color: #f87171;
  border: 1px solid #f87171;
  border-radius: 3px;
  padding: 0 3px;
}

.color-dot {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.color-dot img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
}

.ms-action {
  padding: 0.3rem 0.45rem;
  font-size: 0.68rem;
  position: relative;
  z-index: 1;
  /* Light card matching the board's new classic theme, capped narrower
     than the center so it reads as a compact card, not a full-width
     banner. */
  width: 100%;
  max-width: 260px;
  background: #faf6ea;
  color: #1c1710;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  backdrop-filter: none;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.18);
}

.ms-owned-by {
  font-size: 0.65rem;
}

.ms-buildings .ms-owned-list {
  max-height: 140px;
  overflow-y: auto;
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
  font-size: 0.65rem;
  padding: 0.25rem 0.45rem;
  text-align: left;
}

.ms-auction {
  border: 1px solid rgba(240, 180, 41, 0.5);
}

.ms-debt {
  border: 1px solid rgba(248, 113, 113, 0.5);
}

.ms-bid-input {
  width: 5rem;
  background: #fff;
  color: #1c1710;
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  padding: 0.15rem 0.3rem;
}

.ms-trade-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ms-trade-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.66rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.15);
}

.ms-trade-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ms-trade-btn {
  font-size: 0.6rem;
  padding: 0.22rem 0.45rem;
}

.ms-trade-toggle {
  display: block;
  margin: 0 auto;
}

.ms-trade-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.ms-trade-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.ms-trade-col {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
}

.ms-inline-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.ms-inline-label input {
  width: 4.5rem;
  background: #fff;
  color: #1c1710;
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  padding: 0.1rem 0.3rem;
}

/* The trade-target <select> reuses the app-wide .form-group style (a
   dark input meant for a dark page) -- override it locally since it now
   sits on the board's light center card. */
.ms-trade-form .form-group select {
  background: #fff;
  color: #1c1710;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

.ms-trade-form .form-group label {
  color: #4a4030;
}

.ms-trade-props {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 120px;
  overflow-y: auto;
  font-size: 0.72rem;
}

/* Full-board card reveal -- covers every tile and panel so the drawn
   card is the only thing visible for a few seconds. */
.ms-card-reveal-overlay {
  position: absolute;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8%;
  background: rgba(10, 8, 4, 0.82);
}

/* Same card-detail structure as the title deed card (.ms-deed-card) --
   a colored header bar naming the deck, then a plain body with the
   drawn text -- so drawing a card reads as "here are its details"
   rather than a differently-styled one-off popup. */
.ms-card-reveal {
  width: 100%;
  max-width: 300px;
  background: #fdfbf3;
  border-radius: 8px;
  border: 2px solid rgba(0, 0, 0, 0.4);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  animation: ms-card-flip-in 0.4s ease-out;
}

.ms-card-reveal-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.6rem;
  color: #fff;
  font-size: 1.05rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ms-card-reveal-header-chance {
  background: #2f7bbd;
}

.ms-card-reveal-header-chest {
  background: #b98a3d;
}

.ms-card-reveal-body {
  padding: 1rem 1.1rem 1.2rem;
  text-align: center;
}

.ms-card-reveal-text {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.4;
  color: #1c1710;
}

@keyframes ms-card-flip-in {
  from {
    transform: rotateY(90deg) scale(0.8);
    opacity: 0;
  }
  to {
    transform: rotateY(0deg) scale(1);
    opacity: 1;
  }
}

/* Title deed card -- click any property/station/utility to see it. */
.ms-deed-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6%;
  background: rgba(10, 8, 4, 0.75);
}

.ms-deed-card {
  width: 100%;
  max-width: 260px;
  background: #fdfbf3;
  border-radius: 8px;
  border: 2px solid rgba(0, 0, 0, 0.4);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  animation: ms-card-flip-in 0.35s ease-out;
}

.ms-deed-header {
  height: 44px;
}

.ms-deed-body {
  padding: 0.7rem 0.8rem 0.9rem;
  color: #1c1710;
}

.ms-deed-label {
  margin: 0 0 0.15rem;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-align: center;
  text-transform: uppercase;
  color: #6b5f4a;
}

.ms-deed-name {
  margin: 0 0 0.6rem;
  font-size: 1rem;
  font-weight: 800;
  text-align: center;
  text-transform: uppercase;
}

.ms-deed-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  padding: 0.12rem 0;
}

.ms-deed-rent-label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.ms-deed-icons {
  display: inline-flex;
  align-items: center;
  gap: 1.5px;
}

.ms-deed-note {
  margin: 0 0 0.3rem;
  font-size: 0.68rem;
  line-height: 1.35;
}

.ms-deed-divider {
  border-top: 1px solid rgba(0, 0, 0, 0.25);
  margin: 0.4rem 0;
}

.ms-deed-close {
  display: block;
  width: 100%;
  margin-top: 0.7rem;
}

@media (max-width: 640px) {
  .ms-name,
  .ms-price {
    display: none;
  }
.monopoly-wrap {

  margin: -3dvh auto 10px;
 
}

}
</style>
