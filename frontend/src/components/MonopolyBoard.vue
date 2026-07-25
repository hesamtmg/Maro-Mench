<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BOARD,
  GROUP_COLORS,
  HOTEL_LEVEL,
  backgroundStyleFor,
  iconFor,
  tierFor,
  tokenIconForSeat,
  watermarkFor,
} from "./monopoly/board-config";
import type { RoomPlayer } from "../types";

const props = defineProps<{
  boardState: Record<string, unknown>;
  players: RoomPlayer[];
  currentTurnSeat: number | null;
  mySeatIndex: number | null;
  hidePlayerSummary?: boolean;
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
        :class="[
          `type-${space.type}`,
          tierFor(space) ? `tier-${tierFor(space)}` : '',
          { 'ms-corner': isCorner(space.index), 'ms-mortgaged': mortgagedFor(space.index) },
        ]"
        :style="[
          cellStyle(space.index),
          space.group ? { '--group-color': GROUP_COLORS[space.group] } : {},
          backgroundStyleFor(space) ?? {},
        ]"
      >
        <div v-if="watermarkFor(space)" class="ms-watermark">{{ watermarkFor(space) }}</div>
        <div v-if="mortgagedFor(space.index)" class="ms-mortgaged-badge">M</div>
        <div v-if="space.group" class="ms-swatch" />
        <div v-if="iconFor(space)" class="ms-icon">{{ iconFor(space) }}</div>
        <div class="ms-name">{{ space.name }}</div>
        <div v-if="space.price" class="ms-price">${{ space.price }}</div>
        <div
          v-if="ownerSeatFor(space.index) !== null"
          class="ms-owner-dot"
          :style="{ background: playerColor(ownerSeatFor(space.index)) }"
        />
        <div v-if="playersOn(space.index).length" class="ms-tokens">
          <span
            v-for="p in playersOn(space.index)"
            :key="p.userId"
            class="ms-token"
            :title="p.displayName"
          >{{ tokenIconForSeat(p.seatIndex) }}</span>
        </div>
      </div>

      <div class="ms-center">
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
              <span class="color-dot">{{ tokenIconForSeat(p.seatIndex) }}</span>
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
                    {{ houses >= HOTEL_LEVEL ? '🏨' : '🏠'.repeat(houses) }}
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
                {{ houses >= HOTEL_LEVEL ? '🏨' : '🏠'.repeat(houses) }}
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
            class="btn btn-secondary"
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
  /* Corners (GO, Jail, Free Parking, Go To Jail) stay full-size; the
     ordinary middle tiles run smaller now that houses/hotels no longer
     need to fit on them (see .ms-buildings in the center instead). */
  grid-template-columns: 1.25fr repeat(9, 1fr) 1.25fr;
  grid-template-rows: 1.25fr repeat(9, 1fr) 1.25fr;
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

/* Placeholder tile art. Every space gets a themed gradient + hatch texture
   (poor -> rich for properties, function-based for special spaces) plus a
   faint watermark icon, so the board doesn't look bare while real per-tile
   images are pending. Setting a space's `bgImage` overrides this via the
   inline background-image style and just sits on top of the same base. */
.ms-watermark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(1.1rem, 2.6vw, 1.9rem);
  line-height: 1;
  opacity: 0.24;
  pointer-events: none;
}

.ms-icon,
.ms-name,
.ms-price {
  position: relative;
}

.ms-icon {
  font-size: clamp(0.6rem, 1.4vw, 0.95rem);
  line-height: 1;
}

.ms-name {
  font-size: clamp(0.4rem, 0.85vw, 0.62rem);
  line-height: 1.1;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  word-break: break-word;
}

.ms-price {
  font-size: clamp(0.35rem, 0.75vw, 0.55rem);
  color: rgba(255, 255, 255, 0.72);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

/* Property tiers: poor -> rich */
.tier-1 {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.05) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #5b5148, #3a332b);
}
.tier-2 {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.05) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #7a5a35, #4f3b1e);
}
.tier-3 {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #2f6d7a, #1c434c);
}
.tier-4 {
  background-image: repeating-linear-gradient(45deg, rgba(255, 215, 100, 0.08) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #6b3fa0, #3a2160);
}

/* Special spaces, themed by function */
.type-go {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #1f7a4d, #12482e);
}
.type-jail {
  background-image: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.07) 0 3px, transparent 3px 9px),
    linear-gradient(160deg, #4a4a52, #2a2a30);
}
.type-free_parking {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.05) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #3a5a40, #21331f);
}
.type-go_to_jail {
  background-image: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 3px, transparent 3px 9px),
    linear-gradient(160deg, #7a2530, #430f15);
}
.type-chance {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #6a3fa0, #3a1f60);
}
.type-chest {
  background-image: repeating-linear-gradient(45deg, rgba(255, 215, 100, 0.08) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #a08130, #614c14);
}
.type-tax {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.05) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #7a2f2f, #431919);
}
.type-transit {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #2f4f7a, #182944);
}
.type-utility {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.07) 0 4px, transparent 4px 10px),
    linear-gradient(160deg, #a08a1f, #5f5110);
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

.ms-mortgaged {
  opacity: 0.5;
}

.ms-mortgaged-badge {
  position: absolute;
  top: 2px;
  left: 2px;
  font-size: 0.55rem;
  font-weight: 700;
  color: #f87171;
  border: 1px solid #f87171;
  border-radius: 3px;
  padding: 0 2px;
  line-height: 1.2;
}

.ms-tokens {
  display: flex;
  gap: 1px;
  flex-wrap: wrap;
  justify-content: center;
}

/* Just the piece itself now (no color-circle backdrop) -- a drop
   shadow keeps it legible against whatever's under it on the board. */
.ms-token {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
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
  color: var(--color-text-muted);
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
  color: var(--color-text-muted);
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
  font-size: 0.7rem;
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
  font-size: 15px;
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
}

.ms-action {
  padding: 0.45rem 0.6rem;
  font-size: 0.78rem;
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
  font-size: 0.75rem;
  padding: 0.35rem 0.6rem;
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
}

.ms-trade-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ms-trade-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.78rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--color-border);
}

.ms-trade-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ms-trade-btn {
  font-size: 0.72rem;
  padding: 0.3rem 0.6rem;
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
}

.ms-trade-props {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 120px;
  overflow-y: auto;
  font-size: 0.72rem;
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
