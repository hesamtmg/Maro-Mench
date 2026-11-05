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

// Monopoly tile: a strip of property-group colors, echoing the real board's
// color groups at a glance.
const MONOPOLY_CELL_COLORS = [
  '#8b5a2b',
  '#7ec8e3',
  '#e0559e',
  '#f0932b',
  '#eb4d4b',
  '#f6e58d',
  '#38ac6a',
  '#3455db',
];
const monopolySwatch = Array.from({ length: 16 }, (_, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return MONOPOLY_CELL_COLORS[(row * 4 + col) % MONOPOLY_CELL_COLORS.length];
});

// Conquest tile: a handful of dots in continent colors, echoing the
// territory-graph board at a glance.
const CONQUEST_DOT_COLORS = ['#7ec8e3', '#38ac6a', '#f0932b', '#2f9e44', '#c0392b', '#5b8def'];
const conquestDots = Array.from({ length: 12 }, (_, i) => ({
  color: CONQUEST_DOT_COLORS[i % CONQUEST_DOT_COLORS.length],
  left: `${12 + ((i * 37) % 76)}%`,
  top: `${10 + ((i * 53) % 80)}%`,
}));

// Accent colour, tagline and player count per game -- the same accents
// RoomView uses for each game's header and ambient glow.
const GAME_META: Record<string, { accent: string; tagline: string; players: string }> = {
  ludo: { accent: '#f43f5e', tagline: 'Race all four pieces home', players: '2–4' },
  snakes_ladders: { accent: '#22c55e', tagline: 'Climb ladders, dodge snakes', players: '2–16' },
  olo: { accent: '#38bdf8', tagline: 'Flick your discs to score', players: '2' },
  monopoly: { accent: '#f59e0b', tagline: 'Buy, build and bankrupt', players: '2–6' },
  conquest: { accent: '#a855f7', tagline: 'Conquer the world map', players: '2–6' },
};

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
      <h1 class="brand">GIMOO</h1>
      <div class="row">
        <span class="text-muted">{{ authStore.user?.displayName }}</span>
        <RouterLink :to="{ name: 'stats' }" class="btn btn-secondary">🏆 Stats</RouterLink>
        <button class="btn btn-secondary" @click="handleLogout">Log out</button>
      </div>
    </div>

    <div class="hero">
      <h2 class="hero-title">Pick a game</h2>
      <p class="text-muted hero-sub">Play with friends online: create a room, share the code, roll.</p>
    </div>

    <div class="game-picker">
      <button class="game-tile" :style="{ '--accent': GAME_META.ludo.accent }" @click="chooseGame('ludo')">
        <span class="game-tile-pic ludo-pic" aria-hidden="true">
          <span class="ludo-pic-hub" />
        </span>
        <strong>Ludo</strong>
        <span class="game-tile-tagline">{{ GAME_META.ludo.tagline }}</span>
        <span class="game-tile-players">👥 {{ GAME_META.ludo.players }} players</span>

      </button>

      <button class="game-tile" :style="{ '--accent': GAME_META.snakes_ladders.accent }" @click="chooseGame('snakes_ladders')">
        <span class="game-tile-pic sl-pic" aria-hidden="true">
          <span
            v-for="(color, i) in slSwatch"
            :key="i"
            class="sl-pic-cell"
            :style="{ background: color }"
          />
        </span>
        <strong>Snakes &amp; Ladders</strong>
        <span class="game-tile-tagline">{{ GAME_META.snakes_ladders.tagline }}</span>
        <span class="game-tile-players">👥 {{ GAME_META.snakes_ladders.players }} players</span>

      </button>

      <div class="game-tile-group">
        <button class="game-tile" :style="{ '--accent': GAME_META.olo.accent }" @click="chooseGame('olo')">
          <span class="game-tile-pic olo-pic" aria-hidden="true">
            <span class="olo-pic-disc olo-pic-disc-1" />
            <span class="olo-pic-disc olo-pic-disc-2" />
          </span>
          <strong>OLO</strong>
        <span class="game-tile-tagline">{{ GAME_META.olo.tagline }}</span>
        <span class="game-tile-players">👥 {{ GAME_META.olo.players }} players</span>
        </button>
        <RouterLink :to="{ name: 'olo-practice' }" class="text-muted practice-link">
          🎯 Practice offline
        </RouterLink>
      </div>

      <button class="game-tile" :style="{ '--accent': GAME_META.monopoly.accent }" @click="chooseGame('monopoly')">
        <span class="game-tile-pic monopoly-pic" aria-hidden="true">
          <span
            v-for="(color, i) in monopolySwatch"
            :key="i"
            class="monopoly-pic-cell"
            :style="{ background: color }"
          />
        </span>
        <strong>Monopoly</strong>
        <span class="game-tile-tagline">{{ GAME_META.monopoly.tagline }}</span>
        <span class="game-tile-players">👥 {{ GAME_META.monopoly.players }} players</span>
      </button>

      <button class="game-tile" :style="{ '--accent': GAME_META.conquest.accent }" @click="chooseGame('conquest')">
        <span class="game-tile-pic conquest-pic" aria-hidden="true">
          <span
            v-for="(dot, i) in conquestDots"
            :key="i"
            class="conquest-pic-dot"
            :style="{ background: dot.color, left: dot.left, top: dot.top }"
          />
        </span>
        <strong>Conquest</strong>
        <span class="game-tile-tagline">{{ GAME_META.conquest.tagline }}</span>
        <span class="game-tile-players">👥 {{ GAME_META.conquest.players }} players</span>
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

.game-tile-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.practice-link {
  font-size: 0.8rem;
}

.brand {
  margin: 0;
  font-size: 2rem;
  letter-spacing: 0.06em;
  background: linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #38bdf8, #a855f7);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero {
  text-align: center;
  margin-bottom: 2rem;
}

.hero-title {
  margin: 0 0 0.35rem;
  font-size: 2.2rem;
}

.hero-sub {
  margin: 0;
}

.game-tile {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  width: 230px;
  padding: 1.75rem 1.25rem 1.4rem;
  background:
    radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%),
    var(--color-surface);
  backdrop-filter: blur(8px);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--color-border));
  border-radius: 22px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.game-tile:hover {
  transform: translateY(-6px);
  border-color: color-mix(in srgb, var(--accent) 70%, transparent);
  box-shadow:
    0 16px 34px rgba(0, 0, 0, 0.45),
    0 0 34px color-mix(in srgb, var(--accent) 35%, transparent);
}

.game-tile:hover .game-tile-pic {
  transform: rotate(-4deg) scale(1.06);
}

.game-tile strong {
  margin-top: 0.4rem;
  font-size: 1.2rem;
}

.game-tile-tagline {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.game-tile-players {
  margin-top: 0.2rem;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: color-mix(in srgb, var(--accent) 60%, #fff);
}

.game-tile-pic {
  width: 120px;
  height: 120px;
  border-radius: 22px;
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.2, 1.4, 0.4, 1);
  box-shadow:
    0 10px 20px rgba(0, 0, 0, 0.4),
    0 0 0 3px rgba(255, 255, 255, 0.08),
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

/* OLO tile: two discs about to collide, echoing the disc-duel concept. */
.olo-pic {
  background:
    radial-gradient(circle at 50% 50%, rgba(125, 211, 252, 0.25), transparent 60%),
    linear-gradient(180deg, #0d1b2e, #132a45 50%, #0d1b2e);
  position: relative;
}

.olo-pic-disc {
  position: absolute;
  width: 36%;
  aspect-ratio: 1;
  border-radius: 50%;
  box-shadow:
    0 3px 5px rgba(0, 0, 0, 0.6),
    inset 0 -4px 6px rgba(0, 0, 0, 0.4),
    inset 0 2px 3px rgba(255, 255, 255, 0.35);
}

.olo-pic-disc-1 {
  background: #e0562a;
  top: 24%;
  left: 20%;
}

.olo-pic-disc-2 {
  background: #4a5fc1;
  bottom: 22%;
  right: 18%;
}

/* Monopoly tile: a patchwork of the board's property-group colors. */
.monopoly-pic {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(4, 1fr);
}

.monopoly-pic-cell {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

/* Conquest tile: scattered dots in continent colors, echoing the
   territory-graph board. */
.conquest-pic {
  position: relative;
  background:
    repeating-linear-gradient(0deg, rgba(125, 211, 252, 0.08) 0 1px, transparent 1px 15px),
    repeating-linear-gradient(90deg, rgba(125, 211, 252, 0.08) 0 1px, transparent 1px 15px),
    radial-gradient(circle at 50% 45%, #16304f, #0a1222 75%);
}

.conquest-pic-dot {
  position: absolute;
  width: 12%;
  height: 12%;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
}
</style>
