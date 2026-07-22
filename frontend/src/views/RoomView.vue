<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { roomsApi } from '../api/rooms.api';
import DiceRoller from '../components/DiceRoller.vue';
import LudoBoard from '../components/LudoBoard.vue';
import PlayerList from '../components/PlayerList.vue';
import SnakesLaddersBoard from '../components/SnakesLaddersBoard.vue';
import { useMySeat } from '../composables/useMySeat';
import { useAuthStore } from '../stores/auth.store';
import { useRoomStore } from '../stores/room.store';
import { useToastStore } from '../stores/toast.store';

const props = defineProps<{ id: string }>();

const router = useRouter();
const authStore = useAuthStore();
const roomStore = useRoomStore();
const toastStore = useToastStore();
const { myPlayer, isAdmin, isMyTurn } = useMySeat();

const isLoading = ref(true);
const loadError = ref('');

async function initRoom() {
  isLoading.value = true;
  loadError.value = '';
  try {
    // Ensure we're actually a member (handles direct-link / refresh cases).
    await roomsApi.getRoom(props.id);
    roomStore.connect();
    roomStore.joinRoom(props.id);
  } catch {
    loadError.value = 'Could not load this room. It may no longer exist.';
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
  await router.push({ name: 'lobby' });
}

function handleKick(userId: string) {
  roomStore.kickPlayer(props.id, userId);
}

function handleCopyCode() {
  const code = roomStore.room?.code;
  if (!code) return;
  void navigator.clipboard.writeText(code).then(() => {
    toastStore.success('Room code copied!');
  });
}

const gameTypeCode = computed(() => roomStore.room?.gameType.code);

const myLudoTokens = computed(() => {
  if (!myPlayer.value || gameTypeCode.value !== 'ludo') return [];
  const state = roomStore.boardState as
    | { tokens: Record<number, Array<{ tokenId: number; position: number }>> }
    | null;
  return state?.tokens?.[myPlayer.value.seatIndex] ?? [];
});

const winnerName = computed(() => {
  if (roomStore.winnerSeat === null || roomStore.winnerSeat === undefined) {
    return null;
  }
  return (
    roomStore.room?.players.find((p) => p.seatIndex === roomStore.winnerSeat)
      ?.displayName ?? 'A player'
  );
});

const canStartGame = computed(() => {
  const room = roomStore.room;
  if (!room || !isAdmin.value) return false;
  return (
    room.status === 'waiting' &&
    room.players.length >= room.gameType.minPlayers
  );
});

onMounted(() => {
  void initRoom();
});
</script>

<template>
  <div class="page-container-wide">
    <p v-if="isLoading" class="text-muted text-center">Loading room…</p>
    <p v-else-if="loadError" class="error-text text-center">
      {{ loadError }}
    </p>

    <template v-else-if="roomStore.room">
      <div class="row-between" style="margin-bottom: 1.5rem">
        <div>
          <h1>{{ roomStore.room.gameType.name }}</h1>
          <button
            v-if="roomStore.room.code"
            class="code-chip"
            title="Copy room code"
            @click="handleCopyCode"
          >
            Code: <strong>{{ roomStore.room.code }}</strong> 📋
          </button>
        </div>
        <button class="btn btn-secondary" @click="handleLeaveRoom">
          Leave room
        </button>
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

      <!-- In-progress game -->
      <div v-else-if="roomStore.boardState" class="stack">
        <div class="row-between card">
          <div>
            <strong v-if="isMyTurn" class="turn-badge turn-badge-mine"
              >Your turn!</strong
            >
            <span v-else class="turn-badge">
              {{
                roomStore.room.players.find(
                  (p) => p.seatIndex === roomStore.currentTurnSeat,
                )?.displayName ?? 'Other player'
              }}'s turn…
            </span>
          </div>
          <div class="row">
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
              {{ roomStore.isRolling ? 'Rolling…' : 'Roll dice' }}
            </button>
          </div>
        </div>

        <LudoBoard
          v-if="gameTypeCode === 'ludo'"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :is-my-turn="isMyTurn"
          :awaiting-move-choice="roomStore.awaitingMoveChoice"
          :my-tokens="myLudoTokens"
          :current-turn-seat="roomStore.currentTurnSeat"
          @select-token="handleSelectToken"
        />
        <SnakesLaddersBoard
          v-else-if="gameTypeCode === 'snakes_ladders'"
          :board-state="roomStore.boardState as any"
          :players="roomStore.room.players"
          :current-turn-seat="roomStore.currentTurnSeat"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
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
</style>
