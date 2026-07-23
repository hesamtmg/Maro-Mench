<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';
import type { GameTypeCode } from '../types';

const router = useRouter();
const authStore = useAuthStore();

// Same diagonal 5-color patchwork as SnakesLaddersBoard.vue's cellColor(),
// reused here (as a tiny decorative swatch, not the real board) so the
// picker tile reads as "this is the Snakes & Ladders game" at a glance.
const SL_CELL_COLORS = ['#e6483c', '#f0b429', '#2f6fed', '#3aa15c', '#f5ecd7'];
const slSwatch = Array.from({ length: 16 }, (_, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return SL_CELL_COLORS[(row + col) % SL_CELL_COLORS.length];
});

function chooseGame(gameTypeCode: GameTypeCode) {
  void router.push({ name: 'lobby', query: { game: gameTypeCode } });
}

async function handleLogout() {
  await authStore.logout();
  await router.push({ name: 'login' });
}
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

    <p class="text-center text-muted" style="margin-bottom: 2rem">
      Pick a game to get started
    </p>

    <div class="game-picker">
      <button class="game-tile" @click="chooseGame('ludo')">
        <span class="game-tile-pic ludo-pic" aria-hidden="true">
          <span class="ludo-pic-hub" />
        </span>
        <strong>Ludo</strong>

      </button>

      <button class="game-tile" @click="chooseGame('snakes_ladders')">
        <span class="game-tile-pic sl-pic" aria-hidden="true">
          <span
            v-for="(color, i) in slSwatch"
            :key="i"
            class="sl-pic-cell"
            :style="{ background: color }"
          />
        </span>
        <strong>Snakes &amp; Ladders</strong>

      </button>
    </div>
  </div>
</template>

<style scoped>
.game-picker {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2rem;
}

.game-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  width: 220px;
  padding: 1.75rem 1.5rem;
  background: var(--color-surface);
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-border);
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.game-tile:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
}

.game-tile strong {
  font-size: 1.15rem;
}

.game-tile-pic {
  width: 120px;
  height: 120px;
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 4px 10px rgba(0, 0, 0, 0.35),
    inset 0 0 0 2px rgba(255, 255, 255, 0.15);
}

/* Ludo tile: the same 4-color pinwheel used for the real board's center
   hub, so the tile reads as "Ludo" at a glance. */
.ludo-pic {
  background: conic-gradient(
    from 0deg,
    #e33e3e 0deg 90deg,
    #3aa15c 90deg 180deg,
    #e8b93e 180deg 270deg,
    #3f6fd1 270deg 360deg
  );
  display: grid;
  place-items: center;
}

.ludo-pic-hub {
  width: 34%;
  height: 34%;
  border-radius: 50%;
  background: #fdfaf3;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.25);
}

/* Snakes & Ladders tile: a tiny patchwork swatch matching the real
   board's cell coloring. */
.sl-pic {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(4, 1fr);
}

.sl-pic-cell {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}
</style>
