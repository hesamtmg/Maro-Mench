<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { roomsApi } from "../api/rooms.api";
import ConquestBoard from "../components/ConquestBoard.vue";
import { CONTINENTS, TERRITORIES } from "../components/conquest/board-config";
import DiceRoller from "../components/DiceRoller.vue";
import LudoBoard from "../components/LudoBoard.vue";
import { FINISHED_POSITION } from "../components/ludo/board-geometry";
import MonopolyBoard from "../components/MonopolyBoard.vue";
import {
  BOARD as MONOPOLY_BOARD,
  GROUP_COLORS as MONOPOLY_GROUP_COLORS,
  HOTEL_LEVEL as MONOPOLY_HOTEL_LEVEL,
  tokenIconForSeat,
} from "../components/monopoly/board-config";
import OloBoard from "../components/OloBoard.vue";
import PlayerList from "../components/PlayerList.vue";
import SnakesLaddersBoard from "../components/SnakesLaddersBoard.vue";
import { useMySeat } from "../composables/useMySeat";
import { prettyColor } from "../lib/player-colors";
import { useAuthStore } from "../stores/auth.store";
import { useRoomStore } from "../stores/room.store";
import { useToastStore } from "../stores/toast.store";

const props = defineProps<{ id: string }>();

const router = useRouter();
const authStore = useAuthStore();
const roomStore = useRoomStore();
const toastStore = useToastStore();
const { myPlayer, isAdmin, isMyTurn } = useMySeat();

const isLoading = ref(true);
const loadError = ref("");

// Ticks while a game is in progress so secondsLeft below stays live;
// cheap enough at 4Hz and only running while there's a deadline to show.
const now = ref(Date.now());
let clockHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockHandle = setInterval(() => {
    now.value = Date.now();
  }, 250);
});
onUnmounted(() => {
  if (clockHandle) clearInterval(clockHandle);
});

// Gates the desktop sidebar layout vs. the original mobile stacked
// layout below -- an actual viewport check, not just CSS reshuffling of
// the same markup, so mobile renders the exact same structure it always
// did instead of a reordered version of the desktop one.
const DESKTOP_LAYOUT_BREAKPOINT = 900;
const isWideLayout = ref(
  typeof window !== "undefined" &&
    window.innerWidth > DESKTOP_LAYOUT_BREAKPOINT
);
function updateIsWideLayout() {
  isWideLayout.value = window.innerWidth > DESKTOP_LAYOUT_BREAKPOINT;
}
onMounted(() => {
  window.addEventListener("resize", updateIsWideLayout);
});
onUnmounted(() => {
  window.removeEventListener("resize", updateIsWideLayout);
});

const secondsLeft = computed(() => {
  if (roomStore.turnDeadline == null) return null;
  return Math.max(0, Math.ceil((roomStore.turnDeadline - now.value) / 1000));
});

const timeLeftLabel = computed(() => {
  if (secondsLeft.value == null) return "";
  const m = Math.floor(secondsLeft.value / 60);
  const s = secondsLeft.value % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
});

async function initRoom() {
  isLoading.value = true;
  loadError.value = "";
  try {
    // Ensure we're actually a member (handles direct-link / refresh cases).
    await roomsApi.getRoom(props.id);
    roomStore.connect();
    roomStore.joinRoom(props.id);
  } catch {
    loadError.value = "Could not load this room. It may no longer exist.";
  } finally {
    isLoading.value = false;
  }
}

function handleStartGame() {
  roomStore.startGame(props.id);
}

function handleRollDice() {
  roomStore.rollDice(props.id);
}

function handlePauseGame() {
  roomStore.pauseGame(props.id);
}

function handleResumeGame() {
  roomStore.resumeGame(props.id);
}

function handleSelectToken(tokenId: number) {
  roomStore.makeMove(props.id, tokenId);
}

function handleOloLivePositions(payload: {
  positions: Array<{ id: string; x: number; y: number }>;
}) {
  roomStore.sendOloLivePositions(props.id, payload.positions);
}

function handleOloShotResult(payload: {
  boardState: unknown;
  nextTurnSeat: number;
  isGameOver: boolean;
  winnerSeat?: number;
}) {
  roomStore.sendOloShotResult(props.id, {
    ...payload,
    boardState: payload.boardState as Record<string, unknown>,
  });
}

function handleMonopolyBuyDecision(buy: boolean) {
  roomStore.monopolyPurchaseDecision(props.id, buy);
}

function handleMonopolyBuildHouse(spaceIndex: number) {
  roomStore.monopolyBuildHouse(props.id, spaceIndex);
}

function handleMonopolyPayJailFine() {
  roomStore.monopolyPayJailFine(props.id);
}

function handleMonopolyPlaceBid(amount: number) {
  roomStore.monopolyPlaceBid(props.id, amount);
}

function handleMonopolyPassAuction() {
  roomStore.monopolyPassAuction(props.id);
}

function handleMonopolySellHouse(spaceIndex: number) {
  roomStore.monopolySellHouse(props.id, spaceIndex);
}

function handleMonopolyMortgage(spaceIndex: number) {
  roomStore.monopolyMortgage(props.id, spaceIndex);
}

function handleMonopolyUnmortgage(spaceIndex: number) {
  roomStore.monopolyUnmortgage(props.id, spaceIndex);
}

function handleMonopolyPayDebt() {
  roomStore.monopolyPayDebt(props.id);
}

function handleMonopolyDeclareBankruptcy() {
  roomStore.monopolyDeclareBankruptcy(props.id);
}

function handleMonopolyProposeTrade(offer: {
  toSeat: number;
  offerCash: number;
  offerProperties: number[];
  offerJailCards: number;
  requestCash: number;
  requestProperties: number[];
  requestJailCards: number;
}) {
  roomStore.monopolyProposeTrade(props.id, offer);
}

function handleMonopolyRespondTrade(tradeId: string, accept: boolean) {
  roomStore.monopolyRespondTrade(props.id, tradeId, accept);
}

async function handleLeaveRoom() {
  roomStore.leaveRoom(props.id);
  await router.push({ name: "lobby" });
}

function handleKick(userId: string) {
  roomStore.kickPlayer(props.id, userId);
}

function handleDeleteRoom() {
  if (
    !window.confirm(
      "Delete this room? Everyone will be removed and this cannot be undone."
    )
  ) {
    return;
  }
  roomStore.deleteRoom(props.id);
}

// Fires whenever the room disappears out from under us -- deleted by the
// admin, or (for the room's own admin) the delete they just triggered --
// and sends everyone back to the lobby. Also fires for a normal
// handleLeaveRoom(), where the push below is a harmless no-op since
// we're already mid-navigation to the same route.
watch(
  () => roomStore.room,
  (room, previousRoom) => {
    if (previousRoom && !room) {
      void router.push({ name: "lobby" }).catch(() => {});
    }
  }
);

function handleCopyCode() {
  const code = roomStore.room?.code;
  if (!code) return;
  void navigator.clipboard.writeText(code).then(() => {
    toastStore.success("Room code copied!");
  });
}

const gameTypeCode = computed(() => roomStore.room?.gameType.code);

// Monopoly: a purchase decision, auction, or debt freezes gameState.currentTurnSeat
// on whoever triggered it -- rolling again while one is unresolved would
// silently corrupt that pending decision, so hide the roll button too
// (the backend also rejects it defensively).
const monopolyBlockingDecision = computed(() => {
  if (gameTypeCode.value !== "monopoly") return false;
  const state = roomStore.boardState as {
    pendingPurchase?: unknown;
    auction?: unknown;
    pendingDebt?: unknown;
  } | null;
  return !!(state?.pendingPurchase || state?.auction || state?.pendingDebt);
});

// Monopoly: while an auction is running, the *bidder* whose turn it is to
// act is often a different seat than gameState.currentTurnSeat (the
// player who declined/couldn't afford the property, whose main turn is
// just paused). Without this, that bidder's header would misleadingly
// say "{other player}'s turn..." while it's actually waiting on them.
const monopolyMyBidTurn = computed(() => {
  if (gameTypeCode.value !== "monopoly" || myPlayer.value == null) return false;
  const state = roomStore.boardState as {
    auction?: { currentBidderSeat: number } | null;
  } | null;
  return state?.auction?.currentBidderSeat === myPlayer.value.seatIndex;
});

// Player-status stats, moved here from inside LudoBoard/SnakesLaddersBoard
// so the sidebar can render them next to the board on wide screens
// instead of only below it.
function ludoHomeCount(seatIndex: number): number {
  const state = roomStore.boardState as {
    tokens?: Record<number, Array<{ position: number }>>;
  } | null;
  return (state?.tokens?.[seatIndex] ?? []).filter((t) => t.position === -1)
    .length;
}

function ludoFinishedCount(seatIndex: number): number {
  const state = roomStore.boardState as {
    tokens?: Record<number, Array<{ position: number }>>;
  } | null;
  return (state?.tokens?.[seatIndex] ?? []).filter(
    (t) => t.position === FINISHED_POSITION
  ).length;
}

function snakesLaddersPosition(seatIndex: number): number {
  const state = roomStore.boardState as {
    positions?: Record<number, number>;
  } | null;
  return state?.positions?.[seatIndex] ?? 0;
}

function oloScore(seatIndex: number): number {
  const state = roomStore.boardState as {
    scores?: Record<number, number>;
  } | null;
  return state?.scores?.[seatIndex] ?? 0;
}

function monopolyCash(seatIndex: number): number {
  const state = roomStore.boardState as {
    players?: Record<number, { cash: number; bankrupt: boolean }>;
  } | null;
  return state?.players?.[seatIndex]?.cash ?? 0;
}

// Net worth for the game-over summary: cash plus each owned property's
// value (mortgaged properties count at their half-price liquidation
// value, since that's what they'd actually convert back to in cash).
interface MonopolyNetWorthState {
  players?: Record<number, { cash: number; bankrupt: boolean }>;
  properties?: Record<number, { ownerSeat: number | null; houses: number; mortgaged: boolean }>;
}

const monopolyNetWorth = computed(() => {
  if (gameTypeCode.value !== "monopoly" || !roomStore.room) return [];
  const state = roomStore.boardState as MonopolyNetWorthState | null;
  if (!state) return [];

  return roomStore.room.players
    .map((p) => {
      let worth = state.players?.[p.seatIndex]?.cash ?? 0;
      for (const space of MONOPOLY_BOARD) {
        const prop = state.properties?.[space.index];
        if (!prop || prop.ownerSeat !== p.seatIndex) continue;
        worth += prop.mortgaged
          ? Math.floor((space.price ?? 0) / 2)
          : (space.price ?? 0) + prop.houses * (space.houseCost ?? 0);
      }
      return {
        seatIndex: p.seatIndex,
        displayName: p.displayName,
        color: p.color,
        worth,
        bankrupt: state.players?.[p.seatIndex]?.bankrupt ?? false,
      };
    })
    .sort((a, b) => b.worth - a.worth);
});

function monopolyBankrupt(seatIndex: number): boolean {
  const state = roomStore.boardState as {
    players?: Record<number, { bankrupt: boolean }>;
  } | null;
  return state?.players?.[seatIndex]?.bankrupt ?? false;
}

function conquestTerritoryCount(seatIndex: number): number {
  const state = roomStore.boardState as { owner?: Record<string, number> } | null;
  return Object.values(state?.owner ?? {}).filter((s) => s === seatIndex).length;
}

function conquestEliminated(seatIndex: number): boolean {
  const state = roomStore.boardState as {
    players?: Record<number, { eliminated: boolean }>;
  } | null;
  return state?.players?.[seatIndex]?.eliminated ?? false;
}

function conquestContinentsOwned(seatIndex: number): { id: string; name: string }[] {
  const state = roomStore.boardState as { owner?: Record<string, number> } | null;
  if (!state?.owner) return [];
  const owner = state.owner;
  return CONTINENTS.filter((c) =>
    TERRITORIES.filter((t) => t.continentId === c.id).every((t) => owner[t.id] === seatIndex)
  );
}

type ConquestMissionInstance =
  | { kind: "continents"; continentIds: string[]; description: string }
  | { kind: "territories"; territoryCount: number; description: string }
  | { kind: "eliminate"; targetSeat: number; description: string };

const conquestMissionsEnabled = computed(() => {
  const state = roomStore.boardState as { missionsEnabled?: boolean } | null;
  return state?.missionsEnabled ?? false;
});

const conquestMissions = computed(() => {
  const state = roomStore.boardState as {
    missions?: Record<number, ConquestMissionInstance>;
  } | null;
  return state?.missions ?? {};
});

function conquestMissionText(mission: ConquestMissionInstance): string {
  if (mission.kind === "eliminate") {
    const targetName =
      roomStore.room?.players.find((p) => p.seatIndex === mission.targetSeat)?.displayName ??
      "a player";
    return `${mission.description} Target: ${targetName}.`;
  }
  return mission.description;
}

function conquestTerritoriesOwned(seatIndex: number): { id: string; name: string }[] {
  const state = roomStore.boardState as { owner?: Record<string, number> } | null;
  if (!state?.owner) return [];
  const owner = state.owner;
  return TERRITORIES.filter((t) => owner[t.id] === seatIndex).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function handleConquestReinforce(territoryId: string, count: number) {
  roomStore.conquestReinforce(props.id, territoryId, count);
}

function handleConquestResetReinforcements() {
  roomStore.conquestResetReinforcements(props.id);
}

function handleConquestMoveArmies(fromId: string, toId: string, count: number) {
  roomStore.conquestMoveArmies(props.id, fromId, toId, count);
}

function handleConquestAttack(fromId: string, toId: string, diceCount: number) {
  roomStore.conquestAttack(props.id, fromId, toId, diceCount);
}

function handleConquestOccupyCaptured(additionalCount: number) {
  roomStore.conquestOccupyCaptured(props.id, additionalCount);
}

function handleConquestEndAttackPhase() {
  roomStore.conquestEndAttackPhase(props.id);
}

function handleConquestEndTurn() {
  roomStore.conquestEndTurn(props.id);
}

function handleConquestTradeCards(cardIds: string[]) {
  roomStore.conquestTradeCards(props.id, cardIds);
}

function handleConquestPassTurn() {
  roomStore.conquestPassTurn(props.id);
}

function monopolyInJail(seatIndex: number): boolean {
  const state = roomStore.boardState as {
    players?: Record<number, { inJail: boolean }>;
  } | null;
  return state?.players?.[seatIndex]?.inJail ?? false;
}

function monopolyJailFreeCards(seatIndex: number): number {
  const state = roomStore.boardState as {
    players?: Record<number, { jailFreeCards: number }>;
  } | null;
  return state?.players?.[seatIndex]?.jailFreeCards ?? 0;
}

const MONOPOLY_OWNED_TYPES = new Set(["property", "transit", "utility"]);

function monopolyOwnedProperties(seatIndex: number) {
  const state = roomStore.boardState as MonopolyNetWorthState | null;
  if (!state) return [];
  return MONOPOLY_BOARD.filter(
    (space) => MONOPOLY_OWNED_TYPES.has(space.type) && state.properties?.[space.index]?.ownerSeat === seatIndex
  ).map((space) => {
    const prop = state.properties![space.index];
    return { space, houses: prop.houses, mortgaged: prop.mortgaged };
  });
}

function monopolyNetWorthFor(seatIndex: number): number {
  return monopolyNetWorth.value.find((p) => p.seatIndex === seatIndex)?.worth ?? monopolyCash(seatIndex);
}

const expandedMonopolySeat = ref<number | null>(null);

function toggleMonopolyExpand(seatIndex: number) {
  expandedMonopolySeat.value = expandedMonopolySeat.value === seatIndex ? null : seatIndex;
}

const expandedConquestSeat = ref<number | null>(null);

function toggleConquestExpand(seatIndex: number) {
  expandedConquestSeat.value = expandedConquestSeat.value === seatIndex ? null : seatIndex;
}

const myLudoTokens = computed(() => {
  if (!myPlayer.value || gameTypeCode.value !== "ludo") return [];
  const state = roomStore.boardState as {
    tokens: Record<number, Array<{ tokenId: number; position: number }>>;
  } | null;
  return state?.tokens?.[myPlayer.value.seatIndex] ?? [];
});

const winnerName = computed(() => {
  if (roomStore.winnerSeat === null || roomStore.winnerSeat === undefined) {
    return null;
  }
  return (
    roomStore.room?.players.find((p) => p.seatIndex === roomStore.winnerSeat)
      ?.displayName ?? "A player"
  );
});

// Gates showing turn/dice info in the header -- only once a game is
// actually underway (not waiting, not already finished).
const showTurnInfo = computed(
  () =>
    roomStore.room?.status === "in_progress" &&
    !!roomStore.boardState &&
    !winnerName.value
);

// --- Visual theme ---------------------------------------------------
// Each game gets its own icon + accent color, used by the header tile,
// the ambient glow behind the board and the win screen.
const GAME_THEMES: Record<string, { icon: string; accent: string; tagline: string }> = {
  ludo: { icon: "🎲", accent: "#f43f5e", tagline: "Race all four pieces home" },
  snakes_ladders: { icon: "🐍", accent: "#22c55e", tagline: "Climb ladders, dodge snakes" },
  olo: { icon: "🥏", accent: "#38bdf8", tagline: "Flick your discs to score" },
  monopoly: { icon: "🏙️", accent: "#f59e0b", tagline: "Buy, build and bankrupt" },
  conquest: { icon: "🌍", accent: "#a855f7", tagline: "Conquer the world map" },
};

const gameTheme = computed(
  () => GAME_THEMES[gameTypeCode.value ?? ""] ?? { icon: "🎮", accent: "#9333ea", tagline: "" }
);

function playerColor(seatIndex: number | null | undefined): string {
  return prettyColor(roomStore.room?.players.find((p) => p.seatIndex === seatIndex)?.color);
}

function initialOf(name: string | undefined): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

const currentTurnPlayer = computed(() =>
  roomStore.room?.players.find((p) => p.seatIndex === roomStore.currentTurnSeat)
);

// 0..1 "how close to winning" per seat, drawn as a bar on each player
// card so the race is readable at a glance.
function playerProgress(seatIndex: number): number {
  switch (gameTypeCode.value) {
    case "ludo":
      return ludoFinishedCount(seatIndex) / 4;
    case "snakes_ladders":
      return snakesLaddersPosition(seatIndex) / 100;
    case "conquest":
      return conquestTerritoryCount(seatIndex) / Math.max(1, TERRITORIES.length);
    case "monopoly": {
      const all = roomStore.room?.players.map((p) => monopolyNetWorthFor(p.seatIndex)) ?? [];
      const max = Math.max(1, ...all);
      return monopolyNetWorthFor(seatIndex) / max;
    }
    case "olo": {
      const all = roomStore.room?.players.map((p) => oloScore(p.seatIndex)) ?? [];
      const max = Math.max(1, ...all);
      return oloScore(seatIndex) / max;
    }
    default:
      return 0;
  }
}

const winnerColor = computed(() => playerColor(roomStore.winnerSeat));

// Deterministic confetti layout (no Math.random in render, so it doesn't
// reshuffle on every re-render).
const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#38bdf8", "#a855f7", "#facc15"];
const confettiPieces = Array.from({ length: 48 }, (_, i) => ({
  id: i,
  left: (i * 37) % 100,
  delay: ((i * 13) % 20) / 10,
  duration: 2.6 + ((i * 7) % 10) / 5,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 6 + ((i * 5) % 7),
  round: i % 3 === 0,
}));

const canStartGame = computed(() => {
  const room = roomStore.room;
  if (!room || !isAdmin.value) return false;
  return (
    room.status === "waiting" && room.players.length >= room.gameType.minPlayers
  );
});

onMounted(() => {
  void initRoom();
});
</script>

<template>
  <div
    class="page-container-wide room-page"
    :class="[{ 'page-wide-game': roomStore.boardState }, `theme-${gameTypeCode ?? 'none'}`]"
    :style="{ '--game-accent': gameTheme.accent }"
  >
    <p v-if="isLoading" class="text-muted text-center">Loading room…</p>
    <p v-else-if="loadError" class="error-text text-center">
      {{ loadError }}
    </p>

    <template v-else-if="roomStore.room">
      <div class="game-header">
        <div class="header-title">
          <span class="game-icon" aria-hidden="true">{{ gameTheme.icon }}</span>
          <div class="header-title-text">
            <h1 class="game-title">{{ roomStore.room.gameType.name }}</h1>
            <div class="header-sub">
              <span v-if="gameTheme.tagline" class="game-tagline">{{ gameTheme.tagline }}</span>
              <button
                v-if="roomStore.room.code"
                class="code-chip"
                title="Copy room code"
                @click="handleCopyCode"
              >
                <span class="code-label">Code</span>
                <strong>{{ roomStore.room.code }}</strong>
                <span aria-hidden="true">📋</span>
              </button>
            </div>
          </div>
          <div class="header-room-actions">
            <button
              v-if="isAdmin"
              class="btn btn-danger delete-room-btn"
              @click="handleDeleteRoom"
            >
              Remove
            </button>
            <button class="btn btn-secondary leave-btn" @click="handleLeaveRoom">
              Leave
            </button>
          </div>
        </div>

        <div class="header-actions">
          <div
            v-if="showTurnInfo"
            class="turn-pill"
            :class="{ 'turn-pill-mine': isMyTurn || monopolyMyBidTurn }"
            :style="{ '--turn-color': playerColor(roomStore.currentTurnSeat) }"
          >
            <span class="turn-status">
              <span class="turn-avatar">{{ initialOf(currentTurnPlayer?.displayName) }}</span>
              <strong v-if="isMyTurn" class="turn-badge turn-badge-mine"
                >Your turn!</strong
              >
              <strong
                v-else-if="monopolyMyBidTurn"
                class="turn-badge turn-badge-bid"
                >Your bid!</strong
              >
              <span v-else class="turn-badge">
                {{ currentTurnPlayer?.displayName ?? "Other player" }}'s turn…
              </span>
              <span
                v-if="secondsLeft !== null"
                class="turn-timer"
                :class="{ 'turn-timer-urgent': secondsLeft <= 10 }"
              >
                ⏱ {{ timeLeftLabel }}
              </span>
            </span>

            <template
              v-if="gameTypeCode !== 'olo' && gameTypeCode !== 'conquest' && !roomStore.isPaused"
            >
              <span class="turn-divider" />

              <!-- Monopoly rolls two d6s; lastDiceValue is their sum
                   (up to 12), which doesn't fit the single 1-6 pip die,
                   so it gets two dice from the individually-tracked
                   values instead. -->
              <template v-if="gameTypeCode === 'monopoly'">
                <DiceRoller
                  :value="roomStore.monopolyDice?.[0] ?? null"
                  :is-rolling="roomStore.isRolling"
                />
                <DiceRoller
                  :value="roomStore.monopolyDice?.[1] ?? null"
                  :is-rolling="roomStore.isRolling"
                />
              </template>
              <DiceRoller
                v-else
                :value="roomStore.lastDiceValue"
                :is-rolling="roomStore.isRolling"
              />
              <button
                v-if="isMyTurn && !roomStore.awaitingMoveChoice && !monopolyBlockingDecision"
                class="btn btn-primary"
                :disabled="roomStore.isRolling"
                @click="handleRollDice"
              >
                {{ roomStore.isRolling ? "Rolling…" : "Roll dice" }}
              </button>
            </template>

            <span class="turn-divider" />
            <button
              v-if="!roomStore.isPaused"
              class="btn btn-secondary pause-btn"
              @click="handlePauseGame"
            >
              ⏸ Pause
            </button>
            <button v-else class="btn btn-primary pause-btn" @click="handleResumeGame">
              ▶️ Resume
            </button>
          </div>
        </div>
      </div>

      <!-- Waiting room -->
      <div v-if="roomStore.room.status === 'waiting'" class="stack">
        <PlayerList
          :players="roomStore.room.players"
          :my-user-id="authStore.user?.id"
          :can-kick="isAdmin"
          @kick="handleKick"
        />

        <p class="text-muted">
          Waiting for players ({{ roomStore.room.players.length }} /
          {{ roomStore.room.maxPlayers }}). Need at least
          {{ roomStore.room.gameType.minPlayers }} to start.
        </p>

        <button
          v-if="isAdmin"
          class="btn btn-primary"
          :disabled="!canStartGame"
          @click="handleStartGame"
        >
          Start game
        </button>
        <p v-else class="text-muted">
          Waiting for the room admin to start the game…
        </p>
      </div>

      <!-- Game over -->
      <div
        v-else-if="roomStore.room.status === 'finished' || winnerName"
        class="card text-center game-over-card"
        :style="{ '--winner-color': winnerColor }"
      >
        <div class="confetti" aria-hidden="true">
          <span
            v-for="piece in confettiPieces"
            :key="piece.id"
            class="confetti-piece"
            :class="{ 'confetti-round': piece.round }"
            :style="{
              left: `${piece.left}%`,
              background: piece.color,
              width: `${piece.size}px`,
              height: `${piece.round ? piece.size : piece.size * 1.6}px`,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
            }"
          />
        </div>
        <div class="trophy" aria-hidden="true">🏆</div>
        <p class="game-over-kicker">Game over</p>
        <div v-if="winnerName" class="winner-badge">
          <span class="winner-avatar">{{ initialOf(winnerName) }}</span>
        </div>
        <h2 class="winner-title">{{ winnerName ?? "Nobody" }} wins!</h2>
        <p class="text-muted game-over-sub">{{ roomStore.room.gameType.name }} · GG everyone</p>

        <div v-if="monopolyNetWorth.length" class="net-worth-list">
          <div
            v-for="p in monopolyNetWorth"
            :key="p.seatIndex"
            class="row net-worth-row"
          >
            <span class="color-dot token-3d"><img :src="tokenIconForSeat(p.seatIndex)" alt="" /></span>
            <strong>{{ p.displayName }}</strong>
            <span class="text-muted"
              >${{ p.worth }}<template v-if="p.bankrupt"> · bankrupt</template></span
            >
          </div>
        </div>

        <div v-if="conquestMissionsEnabled" class="net-worth-list">
          <h4 class="panel-title">Secret missions revealed</h4>
          <div
            v-for="p in roomStore.room.players"
            :key="`mission-${p.seatIndex}`"
            class="row net-worth-row"
          >
            <strong>{{ p.displayName }}</strong>
            <span class="text-muted" v-if="conquestMissions[p.seatIndex]">
              {{ conquestMissionText(conquestMissions[p.seatIndex]) }}
            </span>
          </div>
        </div>

        <button class="btn btn-primary" @click="handleLeaveRoom">
          Back to lobby
        </button>
      </div>

      <!-- In-progress game, desktop: sidebar (player status + activity)
           to the left of the board. Gated on an actual viewport check
           (isWideLayout), not a CSS reflow of the mobile markup below. -->
      <div
        v-else-if="roomStore.boardState && isWideLayout"
        class="game-layout"
      >
        <aside class="game-sidebar">
          <div class="card player-status-panel">
            <h4 class="panel-title">Players</h4>
            <div v-for="player in roomStore.room.players" :key="player.userId" class="player-block">
              <div
                class="row player-row"
                :class="{
                  'player-row-active': player.seatIndex === roomStore.currentTurnSeat,
                  clickable: gameTypeCode === 'monopoly' || gameTypeCode === 'conquest',
                }"
                :role="gameTypeCode === 'monopoly' || gameTypeCode === 'conquest' ? 'button' : undefined"
                :tabindex="gameTypeCode === 'monopoly' || gameTypeCode === 'conquest' ? 0 : undefined"
                @click="
                  gameTypeCode === 'monopoly'
                    ? toggleMonopolyExpand(player.seatIndex)
                    : gameTypeCode === 'conquest' && toggleConquestExpand(player.seatIndex)
                "
                @keydown.enter="
                  gameTypeCode === 'monopoly'
                    ? toggleMonopolyExpand(player.seatIndex)
                    : gameTypeCode === 'conquest' && toggleConquestExpand(player.seatIndex)
                "
              >
                <span
                  class="player-avatar"
                  :class="{ 'token-3d': gameTypeCode === 'monopoly' }"
                  :style="{ '--p-color': prettyColor(player.color, '#4f46e5') }"
                >
                  <img
                    v-if="gameTypeCode === 'monopoly'"
                    :src="tokenIconForSeat(player.seatIndex)"
                    alt=""
                  />
                  <template v-else>{{ initialOf(player.displayName) }}</template>
                </span>
                <span class="player-main">
                <span class="player-name-line">
                  <strong class="player-name">{{ player.displayName }}</strong>
                  <span v-if="player.userId === authStore.user?.id" class="you-tag">you</span>
                </span>
                <span v-if="gameTypeCode === 'ludo'" class="text-muted">
                  Home: {{ ludoHomeCount(player.seatIndex) }} · Finished:
                  {{ ludoFinishedCount(player.seatIndex) }} / 4
                </span>
                <span v-else-if="gameTypeCode === 'snakes_ladders'" class="text-muted">
                  Square {{ snakesLaddersPosition(player.seatIndex) }} / 100
                </span>
                <span v-else-if="gameTypeCode === 'olo'" class="text-muted">
                  Score: {{ oloScore(player.seatIndex) }}
                </span>
                <span v-else-if="gameTypeCode === 'monopoly'" class="text-muted">
                  ${{ monopolyCash(player.seatIndex) }}
                  <template v-if="monopolyBankrupt(player.seatIndex)">· bankrupt</template>
                </span>
                <span v-else-if="gameTypeCode === 'conquest'" class="text-muted">
                  {{ conquestTerritoryCount(player.seatIndex) }} territories
                  <template v-if="conquestEliminated(player.seatIndex)">· eliminated</template>
                </span>
                <span class="progress-track" aria-hidden="true">
                  <span
                    class="progress-fill"
                    :style="{
                      width: `${Math.round(Math.min(1, playerProgress(player.seatIndex)) * 100)}%`,
                      background: prettyColor(player.color, '#4f46e5'),
                    }"
                  />
                </span>
                </span>
                <span v-if="gameTypeCode === 'monopoly'" class="expand-caret">
                  {{ expandedMonopolySeat === player.seatIndex ? '▲' : '▼' }}
                </span>
                <span v-else-if="gameTypeCode === 'conquest'" class="expand-caret">
                  {{ expandedConquestSeat === player.seatIndex ? '▲' : '▼' }}
                </span>
              </div>

              <div
                v-if="gameTypeCode === 'monopoly' && expandedMonopolySeat === player.seatIndex"
                class="player-detail"
              >
                <div class="player-detail-stats">
                  <span>💵 ${{ monopolyCash(player.seatIndex) }}</span>
                  <span>📊 Net worth: ${{ monopolyNetWorthFor(player.seatIndex) }}</span>
                  <span>
                    🪪
                    {{
                      monopolyBankrupt(player.seatIndex)
                        ? "Bankrupt"
                        : monopolyInJail(player.seatIndex)
                          ? "In jail"
                          : "Free"
                    }}
                  </span>
                  <span v-if="monopolyJailFreeCards(player.seatIndex) > 0">
                    🎟️ {{ monopolyJailFreeCards(player.seatIndex) }}x Get Out of Jail Free
                  </span>
                </div>

                <p v-if="!monopolyOwnedProperties(player.seatIndex).length" class="text-muted no-properties">
                  Owns no properties yet.
                </p>
                <ul v-else class="owned-list">
                  <li
                    v-for="{ space, houses, mortgaged } in monopolyOwnedProperties(player.seatIndex)"
                    :key="space.index"
                    class="owned-item"
                  >
                    <span
                      v-if="space.group"
                      class="owned-swatch"
                      :style="{ background: MONOPOLY_GROUP_COLORS[space.group] }"
                    />
                    <span class="owned-name">{{ space.name }}</span>
                    <span v-if="houses > 0" class="owned-houses">
                      {{ houses >= MONOPOLY_HOTEL_LEVEL ? '🏨' : '🏠'.repeat(houses) }}
                    </span>
                    <span v-if="mortgaged" class="owned-mortgaged">Mortgaged</span>
                  </li>
                </ul>
              </div>

              <div
                v-if="gameTypeCode === 'conquest' && expandedConquestSeat === player.seatIndex"
                class="player-detail"
              >
                <p v-if="conquestContinentsOwned(player.seatIndex).length > 0" class="player-detail-stats">
                  🌎 {{ conquestContinentsOwned(player.seatIndex).map((c) => c.name).join(", ") }}
                </p>
                <p v-if="!conquestTerritoriesOwned(player.seatIndex).length" class="text-muted no-properties">
                  Owns no territories yet.
                </p>
                <p v-else class="text-muted">
                  {{ conquestTerritoriesOwned(player.seatIndex).map((t) => t.name).join(", ") }}
                </p>
              </div>
            </div>
          </div>

          <!-- Activity log: newest event on top, oldest fading out at the
               bottom of the scrollable window rather than cutting off
               abruptly. -->
          <div v-if="roomStore.eventLog.length" class="event-log card">
            <h4 class="event-log-title">Activity</h4>
            <ul class="event-log-list">
              <li v-for="entry in roomStore.eventLog" :key="entry.id">
                {{ entry.message }}
              </li>
            </ul>
          </div>
        </aside>

        <div class="game-board-area">
          <LudoBoard
            v-if="gameTypeCode === 'ludo'"
            :board-state="roomStore.boardState as any"
            :players="roomStore.room.players"
            :is-my-turn="isMyTurn"
            :awaiting-move-choice="roomStore.awaitingMoveChoice"
            :my-tokens="myLudoTokens"
            :current-turn-seat="roomStore.currentTurnSeat"
            :my-seat-index="myPlayer?.seatIndex ?? null"
            :dice-value="roomStore.awaitingDiceValue"
            hide-player-summary
            @select-token="handleSelectToken"
          />
          <SnakesLaddersBoard
            v-else-if="gameTypeCode === 'snakes_ladders'"
            :board-state="roomStore.boardState as any"
            :players="roomStore.room.players"
            :current-turn-seat="roomStore.currentTurnSeat"
            hide-player-summary
          />
          <OloBoard
            v-else-if="gameTypeCode === 'olo'"
            mode="online"
            :board-state="roomStore.boardState as any"
            :players="roomStore.room.players"
            :current-turn-seat="roomStore.currentTurnSeat"
            :my-seat-index="myPlayer?.seatIndex ?? null"
            :live-opponent-positions="roomStore.oloLiveOpponentPositions"
            @live-positions="handleOloLivePositions"
            @shot-result="handleOloShotResult"
          />
          <MonopolyBoard
            v-else-if="gameTypeCode === 'monopoly'"
            :board-state="roomStore.boardState as any"
            :players="roomStore.room.players"
            :current-turn-seat="roomStore.currentTurnSeat"
            :my-seat-index="myPlayer?.seatIndex ?? null"
            :last-card="roomStore.lastMonopolyCard"
            hide-player-summary
            @buy-decision="handleMonopolyBuyDecision"
            @build-house="handleMonopolyBuildHouse"
            @pay-jail-fine="handleMonopolyPayJailFine"
            @place-bid="handleMonopolyPlaceBid"
            @pass-auction="handleMonopolyPassAuction"
            @propose-trade="handleMonopolyProposeTrade"
            @respond-trade="handleMonopolyRespondTrade"
            @sell-house="handleMonopolySellHouse"
            @mortgage="handleMonopolyMortgage"
            @unmortgage="handleMonopolyUnmortgage"
            @pay-debt="handleMonopolyPayDebt"
            @declare-bankruptcy="handleMonopolyDeclareBankruptcy"
          />
          <ConquestBoard
            v-else-if="gameTypeCode === 'conquest'"
            :board-state="roomStore.boardState as any"
            :players="roomStore.room.players"
            :current-turn-seat="roomStore.currentTurnSeat"
            :my-seat-index="myPlayer?.seatIndex ?? null"
            :last-combat="roomStore.conquestLastCombat"
            hide-player-summary
            @reinforce="handleConquestReinforce"
            @reset-reinforcements="handleConquestResetReinforcements"
            @move-armies="handleConquestMoveArmies"
            @attack="handleConquestAttack"
            @occupy-captured="handleConquestOccupyCaptured"
            @end-attack-phase="handleConquestEndAttackPhase"
            @end-turn="handleConquestEndTurn"
            @trade-cards="handleConquestTradeCards"
            @pass-turn="handleConquestPassTurn"
          />

          <div v-if="roomStore.isPaused" class="paused-overlay">
            <div class="paused-card">
              <p class="paused-title">⏸ Game Paused</p>
              <button class="btn btn-primary" @click="handleResumeGame">
                ▶️ Resume
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- In-progress game, mobile: the original stacked layout, exactly
           as it was -- board (with its own built-in player summary),
           then the activity log below it. -->
      <div v-else-if="roomStore.boardState" class="stack">
        <div class="board-wrap">
        <LudoBoard
          v-if="gameTypeCode === 'ludo'"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :is-my-turn="isMyTurn"
          :awaiting-move-choice="roomStore.awaitingMoveChoice"
          :my-tokens="myLudoTokens"
          :current-turn-seat="roomStore.currentTurnSeat"
          :my-seat-index="myPlayer?.seatIndex ?? null"
          :dice-value="roomStore.awaitingDiceValue"
          @select-token="handleSelectToken"
        />
        <SnakesLaddersBoard
          v-else-if="gameTypeCode === 'snakes_ladders'"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :current-turn-seat="roomStore.currentTurnSeat"
        />
        <OloBoard
          v-else-if="gameTypeCode === 'olo'"
          mode="online"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :current-turn-seat="roomStore.currentTurnSeat"
          :my-seat-index="myPlayer?.seatIndex ?? null"
          :live-opponent-positions="roomStore.oloLiveOpponentPositions"
          @live-positions="handleOloLivePositions"
          @shot-result="handleOloShotResult"
        />
        <MonopolyBoard
          v-else-if="gameTypeCode === 'monopoly'"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :current-turn-seat="roomStore.currentTurnSeat"
          :my-seat-index="myPlayer?.seatIndex ?? null"
          :last-card="roomStore.lastMonopolyCard"
          @buy-decision="handleMonopolyBuyDecision"
          @build-house="handleMonopolyBuildHouse"
          @pay-jail-fine="handleMonopolyPayJailFine"
          @place-bid="handleMonopolyPlaceBid"
          @pass-auction="handleMonopolyPassAuction"
          @propose-trade="handleMonopolyProposeTrade"
          @respond-trade="handleMonopolyRespondTrade"
          @sell-house="handleMonopolySellHouse"
          @mortgage="handleMonopolyMortgage"
          @unmortgage="handleMonopolyUnmortgage"
          @pay-debt="handleMonopolyPayDebt"
          @declare-bankruptcy="handleMonopolyDeclareBankruptcy"
        />
        <ConquestBoard
          v-else-if="gameTypeCode === 'conquest'"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :current-turn-seat="roomStore.currentTurnSeat"
          :my-seat-index="myPlayer?.seatIndex ?? null"
          :last-combat="roomStore.conquestLastCombat"
          @reinforce="handleConquestReinforce"
          @reset-reinforcements="handleConquestResetReinforcements"
          @move-armies="handleConquestMoveArmies"
          @attack="handleConquestAttack"
          @occupy-captured="handleConquestOccupyCaptured"
          @end-attack-phase="handleConquestEndAttackPhase"
          @end-turn="handleConquestEndTurn"
          @trade-cards="handleConquestTradeCards"
          @pass-turn="handleConquestPassTurn"
        />

          <div v-if="roomStore.isPaused" class="paused-overlay">
            <div class="paused-card">
              <p class="paused-title">⏸ Game Paused</p>
              <button class="btn btn-primary" @click="handleResumeGame">
                ▶️ Resume
              </button>
            </div>
          </div>
        </div>

        <div v-if="roomStore.eventLog.length" class="event-log card">
          <h4 class="event-log-title">Activity</h4>
          <ul class="event-log-list">
            <li v-for="entry in roomStore.eventLog" :key="entry.id">
              {{ entry.message }}
            </li>
          </ul>
        </div>
      </div>
    </template>

    <!-- Brief full-screen reaction to big events (a capture, a snake, a
         ladder, game over) -- purely decorative (position: fixed, so its
         place in the DOM doesn't matter), clears itself a moment after
         roomStore sets it. -->
    <Transition name="celebrate">
      <div
        v-if="roomStore.celebration"
        class="celebration-overlay"
        :class="roomStore.celebration"
      >
        <span class="celebration-emoji">{{
          roomStore.celebration === "victory" ? "🎉" : "😬"
        }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Compact header combining the room title/code, the current turn +
   dice/roll controls, and the leave button in one bar -- instead of a
   full-size <h1> plus a separate turn-status card taking up its own row. */
.game-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1.25rem;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.header-title {
  display: flex;
  align-items: center;
  text-align: left;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.header-title-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.header-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.game-tagline {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.header-room-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: 0.5rem;
}

.header-room-actions .btn {
  padding: 0.45rem 1rem;
  font-size: 0.85rem;
}

/* Glossy app-icon style tile carrying the game's emoji, tinted with the
   game's accent color. */
.game-icon {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 1.75rem;
  border-radius: 16px;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.28), transparent 55%),
    linear-gradient(135deg, var(--game-accent), color-mix(in srgb, var(--game-accent) 45%, #000));
  box-shadow:
    0 8px 22px color-mix(in srgb, var(--game-accent) 45%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 -3px 6px rgba(0, 0, 0, 0.25);
}

.game-title {
  font-size: 1.6rem;
  margin: 0;
  line-height: 1.05;
  background: linear-gradient(90deg, #fff, color-mix(in srgb, var(--game-accent) 55%, #fff));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* Soft colored glow behind the play area, in the game's accent color,
   so each game has its own atmosphere. */
.room-page {
  position: relative;
}

.room-page::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(60% 50% at 65% 45%, color-mix(in srgb, var(--game-accent) 16%, transparent), transparent 70%),
    radial-gradient(40% 35% at 10% 90%, color-mix(in srgb, var(--game-accent) 10%, transparent), transparent 70%);
}

.turn-status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.turn-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.8rem;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--turn-color) 60%, #fff), var(--turn-color) 60%);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.85),
    0 0 14px var(--turn-color);
}

.turn-pill-mine {
  border-color: color-mix(in srgb, var(--turn-color) 70%, transparent) !important;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--turn-color) 40%, transparent),
    0 0 26px color-mix(in srgb, var(--turn-color) 35%, transparent);
  animation: my-turn-glow 1.8s ease-in-out infinite;
}

@keyframes my-turn-glow {
  50% {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--turn-color) 70%, transparent),
      0 0 38px color-mix(in srgb, var(--turn-color) 55%, transparent);
  }
}

/* One cohesive chip for turn status + dice + roll button, rather than
   two separately-aligned rows -- reads as a single unit instead of
   scattered controls. */
.turn-pill {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.75rem;
  background: rgba(24, 14, 44, 0.72);
  backdrop-filter: blur(10px);
  border: 1px solid var(--color-border);
  border-radius: 999px;
}

.turn-divider {
  width: 1px;
  height: 1.4rem;
  background: var(--color-border);
}

.turn-pill .btn {
  padding: 0.4rem 0.9rem;
  font-size: 0.85rem;
}

/* Groups the turn/dice pill and the leave button together on the same
   row, on the opposite side of the header from the title -- and, once
   stacked on mobile, keeps the leave button riding along next to the
   dice pill instead of dropping to its own separate row below. */
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Below this, the header's pieces no longer fit on one line comfortably
   -- stack them and let each take the full width instead of squeezing
   together. */
@media (max-width: 640px) {
  .game-header {
    flex-direction: column;
    align-items: stretch;
    /* Pinned to the top of the viewport on mobile so the turn/dice/leave
       controls stay reachable while scrolling down to the board or the
       activity log below. */
    position: sticky;
    top: 0;
    z-index: 10;
    margin-left: -1.25rem;
    margin-right: -1.25rem;
    padding-left: 1.25rem;
    padding-right: 1.25rem;
    padding-top: 0.75rem;
    background: var(--color-bg);
    background-image: var(--color-bg-gradient);
  }

  .header-actions {
    justify-content: space-between;
  }

  .header-title {
    flex-wrap: nowrap;
    gap: 0.6rem;
  }

  .game-icon {
    width: 40px;
    height: 40px;
    font-size: 1.3rem;
    border-radius: 12px;
  }

  .game-title {
    font-size: 1.2rem;
  }

  .game-tagline {
    display: none;
  }

  .header-room-actions {
    margin-left: auto;
    flex-shrink: 0;
  }

  .turn-pill {
    border-radius: var(--radius);
    justify-content: space-between;
  }

  .leave-btn {
    padding: 0.45rem 1rem;
    font-size: 0.85rem;
  }
}

/* Wider than the default page-container-wide, only while a game is in
   progress, so there's actually room for the sidebar beside the board
   instead of everything getting cramped. */
.page-wide-game {
  max-width: 1200px;
}

/* Sidebar (player status + activity) to the left of the board on wide
   screens; the board area shrinks/grows to fill whatever's left. */
.game-layout {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
}

.game-sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  /* Visually first (left of the board), regardless of source order. */
  order: -1;
}

.game-board-area {
  flex: 1;
  min-width: 0;
  position: relative;
}

.board-wrap {
  position: relative;
}

/* Blocks interaction with the board while paused (the server already
   rejects every turn-consuming action, but this makes it visually obvious
   rather than letting clicks silently fail). */
.paused-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 8, 20, 0.6);
  backdrop-filter: blur(2px);
  border-radius: var(--radius);
  z-index: 5;
}

.paused-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem 2rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.paused-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.pause-btn {
  white-space: nowrap;
}

.panel-title {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.color-dot img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Monopoly only (see gameTypeCode checks above) -- a glossy raised-piece
   look instead of a flat color dot, matching MonopolyBoard's own tokens. */
.token-3d img {
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
}

.player-block {
  border-radius: var(--radius);
  overflow: hidden;
}

.player-row {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
  transition: background 0.2s ease;
}

.player-row.clickable {
  cursor: pointer;
}

.player-row-active {
  background: rgba(147, 51, 234, 0.18);
}

.expand-caret {
  margin-left: auto;
  font-size: 0.6rem;
  color: var(--color-text-muted);
}

.player-detail {
  padding: 0.4rem 0.5rem 0.6rem 1.9rem;
  font-size: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.player-detail-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.7rem;
  color: var(--color-text-muted);
}

.no-properties {
  margin: 0;
}

.owned-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.owned-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.owned-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.owned-name {
  flex: 1;
}

.owned-houses {
  font-size: 0.7rem;
}

.owned-mortgaged {
  font-size: 0.65rem;
  color: #f87171;
  border: 1px solid #f87171;
  border-radius: 3px;
  padding: 0 3px;
}

.net-worth-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: 320px;
  margin: 1rem auto 1.5rem;
}

.net-worth-row {
  justify-content: center;
  gap: 0.5rem;
}

.event-log {
  margin-top: 0.25rem;
  padding: 1rem 1.25rem;
}

.event-log-title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.event-log-list {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  /* Fades the bottom of the visible window so the list reads as
     "continues below", rather than looking like it cuts off abruptly. */
  mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
}

.code-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px dashed rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 0.1rem 0.6rem;
  color: var(--color-text);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.code-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.code-chip:hover {
  color: var(--color-primary);
}

.turn-badge {
  font-size: 1rem;
  color: var(--color-text-muted);
}

.turn-badge-mine {
  color: #fff;
  font-size: 1.1rem;
  text-shadow: 0 0 12px var(--turn-color);
}

/* Distinct from turn-badge-mine on purpose: this means "the main turn is
   someone else's, but an auction needs your bid right now" -- a visually
   different cue (amber + pulse) so it doesn't read as your regular turn. */
.turn-badge-bid {
  color: #f0b429;
  font-size: 1.1rem;
  animation: bid-pulse 1.2s ease-in-out infinite;
}

@keyframes bid-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

.turn-timer {
  margin-left: 0.75rem;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.turn-timer-urgent {
  color: #f87171;
  font-weight: 600;
}

.celebration-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 200;
}

.celebration-emoji {
  font-size: 5rem;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45));
}

.celebration-overlay.victory .celebration-emoji {
  animation: celebration-victory 1.1s ease-out;
}

.celebration-overlay.failure .celebration-emoji {
  animation: celebration-failure 0.7s ease-in-out;
}

@keyframes celebration-victory {
  0% {
    transform: scale(0.2) rotate(-15deg);
    opacity: 0;
  }
  35% {
    transform: scale(1.3) rotate(10deg);
    opacity: 1;
  }
  65% {
    transform: scale(0.95) rotate(-5deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 0;
  }
}

@keyframes celebration-failure {
  0% {
    transform: translateX(0) rotate(0);
    opacity: 1;
  }
  20% {
    transform: translateX(-14px) rotate(-8deg);
  }
  40% {
    transform: translateX(10px) rotate(6deg);
  }
  60% {
    transform: translateX(-8px) rotate(-4deg);
  }
  80% {
    transform: translateX(6px) rotate(3deg);
    opacity: 1;
  }
  100% {
    transform: translateX(0) rotate(0);
    opacity: 0;
  }
}

.celebrate-enter-active {
  transition: opacity 0.1s ease;
}

.celebrate-leave-active {
  transition: opacity 0.2s ease;
}

.celebrate-enter-from,
.celebrate-leave-to {
  opacity: 0;
}

/* --- Player cards ---------------------------------------------------- */
.player-status-panel .player-block + .player-block {
  margin-top: 0.4rem;
}

.player-status-panel .player-row {
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
}

.player-status-panel .player-row-active {
  background: linear-gradient(90deg, rgba(147, 51, 234, 0.28), rgba(147, 51, 234, 0.06));
  border-color: rgba(192, 132, 252, 0.45);
  box-shadow: 0 0 18px rgba(147, 51, 234, 0.25);
}

.player-avatar {
  position: relative;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 0.95rem;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--p-color) 55%, #fff), var(--p-color) 62%, color-mix(in srgb, var(--p-color) 70%, #000));
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.15),
    0 4px 10px rgba(0, 0, 0, 0.4);
}

.player-avatar.token-3d {
  background: radial-gradient(circle at 35% 30%, #fff, #e5e7eb 60%, #9ca3af);
  padding: 5px;
}

.player-avatar img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.player-row-active .player-avatar {
  box-shadow:
    0 0 0 2px #fff,
    0 0 16px var(--p-color);
  animation: avatar-bob 1.4s ease-in-out infinite;
}

@keyframes avatar-bob {
  50% {
    transform: translateY(-2px) scale(1.05);
  }
}

.player-main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;
}

.player-name-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.player-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.you-tag {
  font-size: 0.6rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: var(--color-text-muted);
}

.player-main .text-muted {
  font-size: 0.78rem;
}

.progress-track {
  display: block;
  height: 5px;
  margin-top: 0.2rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-fill {
  display: block;
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  box-shadow: 0 0 8px currentColor;
  transition: width 0.6s cubic-bezier(0.2, 0.9, 0.3, 1);
}

/* --- Win screen ------------------------------------------------------ */
.game-over-card {
  position: relative;
  overflow: hidden;
  padding: 2.5rem 1.5rem 2rem;
  max-width: 560px;
  margin: 1rem auto;
  background:
    radial-gradient(80% 60% at 50% 0%, color-mix(in srgb, var(--winner-color) 30%, transparent), transparent 70%),
    rgba(255, 255, 255, 0.05);
  border-color: color-mix(in srgb, var(--winner-color) 45%, transparent);
}

.confetti {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.confetti-piece {
  position: absolute;
  top: -20px;
  border-radius: 2px;
  opacity: 0.9;
  animation-name: confetti-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.confetti-round {
  border-radius: 50%;
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
  }
  100% {
    transform: translateY(620px) rotate(720deg);
  }
}

.trophy {
  position: relative;
  font-size: 4.5rem;
  line-height: 1;
  filter: drop-shadow(0 8px 18px rgba(250, 204, 21, 0.45));
  animation: trophy-pop 0.9s cubic-bezier(0.2, 1.6, 0.4, 1) both, trophy-float 3s ease-in-out 0.9s infinite;
}

@keyframes trophy-pop {
  from {
    transform: scale(0.2) rotate(-20deg);
    opacity: 0;
  }
}

@keyframes trophy-float {
  50% {
    transform: translateY(-6px) rotate(3deg);
  }
}

.game-over-kicker {
  position: relative;
  margin: 0.75rem 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.winner-badge {
  position: relative;
  display: flex;
  justify-content: center;
  margin: 0.5rem 0;
}

.winner-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 1.6rem;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--winner-color) 55%, #fff), var(--winner-color) 65%);
  box-shadow:
    0 0 0 3px #fff,
    0 0 30px var(--winner-color);
}

.winner-title {
  position: relative;
  margin: 0.5rem 0 0.25rem;
  font-size: 2rem;
  background: linear-gradient(90deg, #fde68a, #fff, #fde68a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.game-over-sub {
  position: relative;
  margin: 0 0 1rem;
}

.game-over-card .net-worth-list,
.game-over-card .btn {
  position: relative;
}

@media (prefers-reduced-motion: reduce) {
  .confetti {
    display: none;
  }
  .trophy,
  .turn-pill-mine,
  .player-row-active .player-avatar {
    animation: none;
  }
}
</style>
