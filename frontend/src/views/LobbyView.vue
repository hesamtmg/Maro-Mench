<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { roomsApi } from '../api/rooms.api';
import { connectSocket, getSocket } from '../api/socket.client';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from '../api/ws-events.constants';
import { useAuthStore } from '../stores/auth.store';
import { useToastStore } from '../stores/toast.store';
import type { GameTypeCode, Room } from '../types';
import type { AxiosError } from 'axios';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

const activeAction = ref<'public' | 'create' | 'join' | 'queue' | null>(null);

// --- Public rooms list ---
const publicRooms = ref<Room[]>([]);
const publicRoomsGameFilter = ref<GameTypeCode | ''>('');
const isLoadingRooms = ref(false);

async function loadPublicRooms() {
  isLoadingRooms.value = true;
  try {
    const result = await roomsApi.listPublicRooms({
      gameTypeCode: publicRoomsGameFilter.value || undefined,
    });
    publicRooms.value = result.rooms;
  } finally {
    isLoadingRooms.value = false;
  }
}

async function joinPublicRoom(roomId: string) {
  try {
    await roomsApi.joinById(roomId);
    await router.push({ name: 'room', params: { id: roomId } });
  } catch (err) {
    const axiosErr = err as AxiosError<{ message: string }>;
    toastStore.error(
      axiosErr.response?.data?.message ?? 'Could not join that room.',
    );
  }
}

// A room already showing up here that I'm a seated player in (joined,
// ready, or disconnected mid-game) -- lets the list double as a way back
// into a game I left/disconnected from, not just a browse-to-join list.
function isMyRoom(room: Room): boolean {
  const userId = authStore.user?.id;
  return !!userId && room.players.some((p) => p.userId === userId);
}

// --- Create room ---
const createGameType = ref<GameTypeCode>('ludo');
const createVisibility = ref<'public' | 'private'>('public');
const createMaxPlayers = ref(4);
const isCreating = ref(false);
const createError = ref('');

async function handleCreateRoom() {
  createError.value = '';
  isCreating.value = true;
  try {
    const room = await roomsApi.createRoom({
      gameTypeCode: createGameType.value,
      visibility: createVisibility.value,
      maxPlayers: createMaxPlayers.value,
    });
    await router.push({ name: 'room', params: { id: room.id } });
  } catch (err) {
    const axiosErr = err as AxiosError<{ message: string }>;
    createError.value =
      axiosErr.response?.data?.message ?? 'Could not create room.';
  } finally {
    isCreating.value = false;
  }
}

// --- Join by code ---
const joinCode = ref('');
const isJoiningByCode = ref(false);
const joinCodeError = ref('');

async function handleJoinByCode() {
  joinCodeError.value = '';
  isJoiningByCode.value = true;
  try {
    const room = await roomsApi.joinByCode(joinCode.value.trim().toUpperCase());
    await router.push({ name: 'room', params: { id: room.id } });
  } catch (err) {
    const axiosErr = err as AxiosError<{ message: string }>;
    joinCodeError.value =
      axiosErr.response?.data?.message ?? 'Invalid or expired room code.';
  } finally {
    isJoiningByCode.value = false;
  }
}

// --- Matchmaking queue ---
const queueGameType = ref<GameTypeCode>('ludo');
const isQueued = ref(false);
const queueMessage = ref('');

function joinQueue() {
  connectSocket();
  queueMessage.value = '';
  getSocket().emit(WS_EVENTS_IN.JOIN_QUEUE, {
    gameTypeCode: queueGameType.value,
  });
  isQueued.value = true;
}

function cancelQueue() {
  getSocket().emit(WS_EVENTS_IN.CANCEL_QUEUE, {});
  isQueued.value = false;
}

function setupQueueListeners() {
  const socket = connectSocket();
  socket.on(WS_EVENTS_OUT.QUEUE_JOINED, () => {
    queueMessage.value = 'Searching for opponents…';
  });
  socket.on(WS_EVENTS_OUT.QUEUE_CANCELLED, () => {
    isQueued.value = false;
    queueMessage.value = '';
  });
  socket.on(WS_EVENTS_OUT.MATCH_FOUND, (payload: { roomId: string }) => {
    isQueued.value = false;
    toastStore.success('Match found! Joining room…');
    void router.push({ name: 'room', params: { id: payload.roomId } });
  });
  socket.on(WS_EVENTS_OUT.ERROR, (payload: { message: string }) => {
    isQueued.value = false;
    queueMessage.value = '';
    toastStore.error(payload.message);
  });
}

function teardownQueueListeners() {
  const socket = getSocket();
  socket.off(WS_EVENTS_OUT.QUEUE_JOINED);
  socket.off(WS_EVENTS_OUT.QUEUE_CANCELLED);
  socket.off(WS_EVENTS_OUT.MATCH_FOUND);
  socket.off(WS_EVENTS_OUT.ERROR);
}

async function handleLogout() {
  await authStore.logout();
  await router.push({ name: 'login' });
}

onMounted(() => {
  // Arriving from the game-picker (HomeView) with ?game=ludo|snakes_ladders
  // scopes every game-type select here to that choice, so "pick a game,
  // land in the lobby already set up for it" actually holds.
  const gameParam = route.query.game;
  if (gameParam === 'ludo' || gameParam === 'snakes_ladders') {
    createGameType.value = gameParam;
    publicRoomsGameFilter.value = gameParam;
    queueGameType.value = gameParam;
  }
  void loadPublicRooms();
  setupQueueListeners();
});

onUnmounted(() => {
  teardownQueueListeners();
});
</script>

<template>
  <div class="page-container-wide">
    <div class="row-between" style="margin-bottom: 1.5rem">
      <div>
        <h1 style="margin-bottom: 0.15rem">MaroMench</h1>
        <RouterLink :to="{ name: 'home' }" class="text-muted"
          >← Change game</RouterLink
        >
      </div>
      <div class="row">
        <span class="text-muted">{{ authStore.user?.displayName }}</span>
        <button class="btn btn-secondary" @click="handleLogout">Log out</button>
      </div>
    </div>

    <!-- Hero action row: pick what you want to do, like Foony's
         Play Bots / Create Room / Join by Code button row. -->
    <div class="action-grid">
      <button
        class="action-card action-create"
        :class="{ active: activeAction === 'create' }"
        @click="activeAction = activeAction === 'create' ? null : 'create'"
      >
        <span class="action-icon">➕</span>
        <strong>Create Room</strong>
        <span class="action-sub">Start a new public or private game</span>
      </button>

      <button
        class="action-card action-public"
        :class="{ active: activeAction === 'public' }"
        @click="activeAction = activeAction === 'public' ? null : 'public'"
      >
        <span class="action-icon">🌐</span>
        <strong>Public Rooms</strong>
        <span class="action-badge" v-if="publicRooms.length">{{
          publicRooms.length
        }}</span>
        <span class="action-sub">Join a game already waiting for players</span>
      </button>

      <button
        class="action-card action-queue"
        :class="{ active: activeAction === 'queue' }"
        @click="activeAction = activeAction === 'queue' ? null : 'queue'"
      >
        <span class="action-icon">⚡</span>
        <strong>Quick Match</strong>
        <span class="action-sub">We'll pair you up automatically</span>
      </button>

      <button
        class="action-card action-join"
        :class="{ active: activeAction === 'join' }"
        @click="activeAction = activeAction === 'join' ? null : 'join'"
      >
        <span class="action-icon">🔑</span>
        <strong>Join by Code</strong>
        <span class="action-sub">Have an invite code? Enter it here</span>
      </button>
    </div>

    <!-- Public rooms panel -->
    <div v-if="activeAction === 'public'" class="stack panel">
      <div class="row">
        <select v-model="publicRoomsGameFilter" @change="loadPublicRooms">
          <option value="">All games</option>
          <option value="ludo">Ludo </option>
          <option value="snakes_ladders">Snakes &amp; Ladders</option>
        </select>
        <button class="btn btn-secondary" @click="loadPublicRooms">
          Refresh
        </button>
      </div>

      <p v-if="isLoadingRooms" class="text-muted">Loading rooms…</p>
      <p v-else-if="publicRooms.length === 0" class="text-muted">
        No public rooms right now. Why not create one?
      </p>

      <div v-for="room in publicRooms" :key="room.id" class="card row-between">
        <div>
          <strong>{{ room.gameType.name }}</strong>
          <span
            v-if="room.status === 'in_progress'"
            class="badge room-status-badge"
            >In progress</span
          >
          <span v-if="room.code" class="badge room-code-badge"
            >Code: {{ room.code }}</span
          >
          <div class="text-muted">
            {{ room.players.length }} / {{ room.maxPlayers }} players
          </div>
        </div>
        <button
          v-if="room.status === 'waiting' || isMyRoom(room)"
          class="btn btn-primary"
          @click="joinPublicRoom(room.id)"
        >
          {{ isMyRoom(room) ? 'Rejoin' : 'Join' }}
        </button>
        <span v-else class="text-muted">Already in progress</span>
      </div>
    </div>

    <!-- Create room panel -->
    <div v-else-if="activeAction === 'create'" class="card panel">
      <h3>Create a room</h3>
      <form class="stack" @submit.prevent="handleCreateRoom">
        <div class="form-group">
          <label for="createGameType">Game</label>
          <select id="createGameType" v-model="createGameType">
            <option value="ludo">Ludo </option>
            <option value="snakes_ladders">
              Snakes &amp; Ladders 
            </option>
          </select>
        </div>

        <div class="form-group">
          <label for="createVisibility">Visibility</label>
          <select id="createVisibility" v-model="createVisibility">
            <option value="public">Public (anyone can join)</option>
            <option value="private">Private (invite code)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="createMaxPlayers">Max players</label>
          <input
            id="createMaxPlayers"
            v-model.number="createMaxPlayers"
            type="number"
            min="2"
            :max="createGameType === 'ludo' ? 4 : 16"
          />
        </div>

        <p v-if="createError" class="error-text">{{ createError }}</p>

        <button type="submit" class="btn btn-primary" :disabled="isCreating">
          {{ isCreating ? 'Creating…' : 'Create room' }}
        </button>
      </form>
    </div>

    <!-- Join by code panel -->
    <div v-else-if="activeAction === 'join'" class="card panel">
      <h3>Join with a code</h3>
      <form class="stack" @submit.prevent="handleJoinByCode">
        <div class="form-group">
          <label for="joinCode">Room code</label>
          <input
            id="joinCode"
            v-model="joinCode"
            type="text"
            required
            maxlength="12"
            placeholder="e.g. KF5N2H"
            style="text-transform: uppercase"
          />
        </div>

        <p v-if="joinCodeError" class="error-text">{{ joinCodeError }}</p>

        <button type="submit" class="btn btn-primary" :disabled="isJoiningByCode">
          {{ isJoiningByCode ? 'Joining…' : 'Join room' }}
        </button>
      </form>
    </div>

    <!-- Quick match / matchmaking panel -->
    <div v-else-if="activeAction === 'queue'" class="card panel">
      <h3>Quick match</h3>
      <p class="text-muted">
        We'll pair you with other players automatically.
      </p>

      <div class="form-group">
        <label for="queueGameType">Game</label>
        <select id="queueGameType" v-model="queueGameType" :disabled="isQueued">
          <option value="ludo">Ludo </option>
          <option value="snakes_ladders">Snakes &amp; Ladders </option>
        </select>
      </div>

      <p v-if="queueMessage" class="text-muted">{{ queueMessage }}</p>

      <button v-if="!isQueued" class="btn btn-primary" @click="joinQueue">
        Find match
      </button>
      <button v-else class="btn btn-danger" @click="cancelQueue">
        Cancel search
      </button>
    </div>
  </div>
</template>

<style scoped>
.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.action-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-top: 4px solid var(--accent, var(--color-primary));
  border-radius: var(--radius);
  padding: 1.25rem 1.25rem 1rem;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}

.action-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
}

.action-card.active {
  background: color-mix(in srgb, var(--accent, var(--color-primary)) 10%, var(--color-surface));
  box-shadow: 0 0 0 2px var(--accent, var(--color-primary));
}

.action-create {
  --accent: #e33e3e;
}
.action-public {
  --accent: #3f6fd1;
}
.action-queue {
  --accent: #e8b93e;
}
.action-join {
  --accent: #3aa15c;
}

.action-icon {
  font-size: 1.75rem;
  line-height: 1;
}

.action-sub {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.action-badge {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  min-width: 1.5rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  font-size: 0.75rem;
  font-weight: 700;
  text-align: center;
}

.panel {
  animation: panel-in 0.15s ease-out;
}

.room-code-badge {
  margin-left: 0.6rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}

.room-status-badge {
  margin-left: 0.6rem;
  background: rgba(240, 180, 41, 0.18);
  color: #f0b429;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
