<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { roomsApi } from "../api/rooms.api";
import DiceRoller from "../components/DiceRoller.vue";
import LudoBoard from "../components/LudoBoard.vue";
import { FINISHED_POSITION } from "../components/ludo/board-geometry";
import PlayerList from "../components/PlayerList.vue";
import SnakesLaddersBoard from "../components/SnakesLaddersBoard.vue";
import { useMySeat } from "../composables/useMySeat";
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

function handleSelectToken(tokenId: number) {
  roomStore.makeMove(props.id, tokenId);
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
    class="page-container-wide"
    :class="{ 'page-wide-game': roomStore.boardState }"
  >
    <p v-if="isLoading" class="text-muted text-center">Loading room…</p>
    <p v-else-if="loadError" class="error-text text-center">
      {{ loadError }}
    </p>

    <template v-else-if="roomStore.room">
      <div class="game-header">
        <div class="header-title " style="display: flex;flex-direction: row;">
          <div style="width: 100%;">
            <h1 class="game-title">{{ roomStore.room.gameType.name }}</h1>
            <button
              v-if="roomStore.room.code"
              class="code-chip"
              title="Copy room code"
              @click="handleCopyCode"
            >
              Code: <strong>{{ roomStore.room.code }}</strong> 📋
            </button>
          </div>
          <div style="display:flex;flex-direction: row;width: 100%;">
            <button
              v-if="isAdmin"
              style="margin-left: 10px;"
              class="btn btn-danger delete-room-btn"
              @click="handleDeleteRoom"
            >
            Remove
            </button>

            <button
              style="margin-left: 10px;"
              class="btn btn-secondary leave-btn "
              @click="handleLeaveRoom"
            >
              Leave
            </button>
          </div>
        </div>

        <div class="header-actions">
          <div v-if="showTurnInfo" class="turn-pill">
            <span>
              <strong v-if="isMyTurn" class="turn-badge turn-badge-mine"
                >Your turn!</strong
              >
              <span v-else class="turn-badge">
                {{
                  roomStore.room.players.find(
                    (p) => p.seatIndex === roomStore.currentTurnSeat
                  )?.displayName ?? "Other player"
                }}'s turn…
              </span>
              <span
                v-if="secondsLeft !== null"
                class="turn-timer"
                :class="{ 'turn-timer-urgent': secondsLeft <= 10 }"
              >
                ⏱ {{ secondsLeft }}s
              </span>
            </span>

            <span class="turn-divider" />

            <DiceRoller
              :value="roomStore.lastDiceValue"
              :is-rolling="roomStore.isRolling"
            />
            <button
              v-if="isMyTurn && !roomStore.awaitingMoveChoice"
              class="btn btn-primary"
              :disabled="roomStore.isRolling"
              @click="handleRollDice"
            >
              {{ roomStore.isRolling ? "Rolling…" : "Roll dice" }}
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
        class="card text-center"
      >
        <h2>🎉 {{ winnerName }} wins!</h2>
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
            <div
              v-for="player in roomStore.room.players"
              :key="player.userId"
              class="row player-row"
              :class="{
                'player-row-active': player.seatIndex === roomStore.currentTurnSeat,
              }"
            >
              <span
                class="color-dot"
                :style="{ background: player.color ?? '#4f46e5' }"
              />
              <strong>{{ player.displayName }}</strong>
              <span v-if="gameTypeCode === 'ludo'" class="text-muted">
                Home: {{ ludoHomeCount(player.seatIndex) }} · Finished:
                {{ ludoFinishedCount(player.seatIndex) }} / 4
              </span>
              <span v-else-if="gameTypeCode === 'snakes_ladders'" class="text-muted">
                Square {{ snakesLaddersPosition(player.seatIndex) }} / 100
              </span>
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
        </div>
      </div>

      <!-- In-progress game, mobile: the original stacked layout, exactly
           as it was -- board (with its own built-in player summary),
           then the activity log below it. -->
      <div v-else-if="roomStore.boardState" class="stack">
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
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 0.15rem;
}

.game-title {
  font-size: 1.35rem;
  margin: 0;
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
  background: var(--color-surface);
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
  background: rgba(147, 51, 234, 0.18);
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
  background: none;
  border: none;
  padding: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  cursor: pointer;
}

.code-chip:hover {
  color: var(--color-primary);
}

.turn-badge {
  font-size: 1rem;
  color: var(--color-text-muted);
}

.turn-badge-mine {
  color: var(--color-primary);
  font-size: 1.1rem;
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
</style>
