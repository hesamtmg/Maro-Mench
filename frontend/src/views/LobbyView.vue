<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { roomsApi } from '../api/rooms.api';
import { connectSocket, getSocket } from '../api/socket.client';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from '../api/ws-events.constants';
import { useAuthStore } from '../stores/auth.store';
import { useToastStore } from '../stores/toast.store';
import type { GameTypeCode, Room } from '../types';
import type { AxiosError } from 'axios';

const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

const activeTab = ref<'public' | 'private' | 'queue'>('public');

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
  await roomsApi.joinById(roomId);
  await router.push({ name: 'room', params: { id: roomId } });
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
      <h1>MaroMench</h1>
      <div class="row">
        <span class="text-muted">{{ authStore.user?.displayName }}</span>
        <button class="btn btn-secondary" @click="handleLogout">Log out</button>
      </div>
    </div>

    <div class="row" style="margin-bottom: 1.5rem">
      <button
        class="btn"
        :class="activeTab === 'public' ? 'btn-primary' : 'btn-secondary'"
        @click="activeTab = 'public'"
      >
        Public rooms
      </button>
      <button
        class="btn"
        :class="activeTab === 'private' ? 'btn-primary' : 'btn-secondary'"
        @click="activeTab = 'private'"
      >
        Create / join
      </button>
      <button
        class="btn"
        :class="activeTab === 'queue' ? 'btn-primary' : 'btn-secondary'"
        @click="activeTab = 'queue'"
      >
        Quick match
      </button>
    </div>

    <!-- Public rooms tab -->
    <div v-if="activeTab === 'public'" class="stack">
      <div class="row">
        <select v-model="publicRoomsGameFilter" @change="loadPublicRooms">
          <option value="">All games</option>
          <option value="ludo">Ludo (منچ)</option>
          <option value="snakes_ladders">Snakes &amp; Ladders (ماروپله)</option>
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
          <div class="text-muted">
            {{ room.players.length }} / {{ room.maxPlayers }} players
          </div>
        </div>
        <button class="btn btn-primary" @click="joinPublicRoom(room.id)">
          Join
        </button>
      </div>
    </div>

    <!-- Create / join by code tab -->
    <div
      v-else-if="activeTab === 'private'"
      class="row"
      style="align-items: flex-start; gap: 1.5rem"
    >
      <div class="card" style="flex: 1">
        <h3>Create a room</h3>
        <form class="stack" @submit.prevent="handleCreateRoom">
          <div class="form-group">
            <label for="createGameType">Game</label>
            <select id="createGameType" v-model="createGameType">
              <option value="ludo">Ludo (منچ)</option>
              <option value="snakes_ladders">
                Snakes &amp; Ladders (ماروپله)
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

      <div class="card" style="flex: 1">
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

          <button
            type="submit"
            class="btn btn-primary"
            :disabled="isJoiningByCode"
          >
            {{ isJoiningByCode ? 'Joining…' : 'Join room' }}
          </button>
        </form>
      </div>
    </div>

    <!-- Quick match / matchmaking tab -->
    <div v-else class="card">
      <h3>Quick match</h3>
      <p class="text-muted">
        We'll pair you with other players automatically.
      </p>

      <div class="form-group">
        <label for="queueGameType">Game</label>
        <select id="queueGameType" v-model="queueGameType" :disabled="isQueued">
          <option value="ludo">Ludo (منچ)</option>
          <option value="snakes_ladders">Snakes &amp; Ladders (ماروپله)</option>
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
