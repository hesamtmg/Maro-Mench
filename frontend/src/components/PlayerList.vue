<script setup lang="ts">
import type { RoomPlayer } from '../types';

const props = defineProps<{
  players: RoomPlayer[];
  myUserId: string | undefined;
  canKick: boolean;
}>();

const emit = defineEmits<{
  kick: [userId: string];
}>();

function statusLabel(status: RoomPlayer['status']): string {
  switch (status) {
    case 'joined':
      return 'Waiting';
    case 'ready':
      return 'Ready';
    case 'disconnected':
      return 'Disconnected';
    default:
      return status;
  }
}
</script>

<template>
  <div class="stack">
    <div
      v-for="player in props.players"
      :key="player.userId"
      class="row-between card"
      style="padding: 0.75rem 1rem"
    >
      <div class="row">
        <span
          v-if="player.color"
          class="color-dot"
          :style="{ background: player.color }"
        />
        <strong>{{ player.displayName || 'Player' }}</strong>
        <span v-if="player.userId === props.myUserId" class="text-muted"
          >(you)</span
        >
        <span v-if="player.isAdmin" class="badge">Admin</span>
      </div>
      <div class="row">
        <span
          class="badge"
          :class="{ 'badge-live': player.status === 'ready' }"
          >{{ statusLabel(player.status) }}</span
        >
        <button
          v-if="props.canKick && player.userId !== props.myUserId"
          class="btn btn-danger"
          style="padding: 0.3rem 0.7rem; font-size: 0.8rem"
          @click="emit('kick', player.userId)"
        >
          Kick
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
</style>
