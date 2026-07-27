<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { statsApi } from '../api/stats.api';
import type { GameResultDto, LeaderboardEntryDto, UserGameStatsDto } from '../api/stats.api';
import { useAuthStore } from '../stores/auth.store';
import type { GameTypeCode } from '../types';

const authStore = useAuthStore();

const GAME_TYPES: { code: GameTypeCode; name: string }[] = [
  { code: 'ludo', name: 'Ludo' },
  { code: 'snakes_ladders', name: 'Snakes & Ladders' },
  { code: 'olo', name: 'OLO' },
  { code: 'monopoly', name: 'Monopoly' },
  { code: 'conquest', name: 'Conquest' },
];

// --- My stats ---
const myStats = ref<UserGameStatsDto[]>([]);
const myStatsLoading = ref(true);
const myStatsError = ref('');

async function loadMyStats() {
  myStatsLoading.value = true;
  myStatsError.value = '';
  try {
    myStats.value = await statsApi.getMyStats();
  } catch {
    myStatsError.value = 'Could not load your stats.';
  } finally {
    myStatsLoading.value = false;
  }
}

// --- My history ---
const history = ref<GameResultDto[]>([]);
const historyTotal = ref(0);
const historyPage = ref(1);
const historyPageSize = 10;
const historyLoading = ref(true);
const historyError = ref('');

async function loadHistory() {
  historyLoading.value = true;
  historyError.value = '';
  try {
    const data = await statsApi.getMyHistory({
      page: historyPage.value,
      pageSize: historyPageSize,
    });
    history.value = data.results;
    historyTotal.value = data.total;
  } catch {
    historyError.value = 'Could not load your match history.';
  } finally {
    historyLoading.value = false;
  }
}

const hasMoreHistory = computed(
  () => historyPage.value * historyPageSize < historyTotal.value
);

function nextHistoryPage() {
  if (!hasMoreHistory.value) return;
  historyPage.value += 1;
  void loadHistory();
}

function prevHistoryPage() {
  if (historyPage.value <= 1) return;
  historyPage.value -= 1;
  void loadHistory();
}

// --- Leaderboard ---
const leaderboardGameType = ref<GameTypeCode>('conquest');
const leaderboardEntries = ref<LeaderboardEntryDto[]>([]);
const leaderboardLoading = ref(true);
const leaderboardError = ref('');

async function loadLeaderboard() {
  leaderboardLoading.value = true;
  leaderboardError.value = '';
  try {
    const data = await statsApi.getLeaderboard(leaderboardGameType.value);
    leaderboardEntries.value = data.entries;
  } catch {
    leaderboardError.value = 'Could not load the leaderboard.';
  } finally {
    leaderboardLoading.value = false;
  }
}

watch(leaderboardGameType, () => void loadLeaderboard());

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatWinRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

onMounted(() => {
  void loadMyStats();
  void loadHistory();
  void loadLeaderboard();
});
</script>

<template>
  <div class="page-container-wide">
    <div class="row-between" style="margin-bottom: 1.5rem">
      <h1>🏆 Stats &amp; Leaderboard</h1>
      <RouterLink :to="{ name: 'home' }" class="text-muted">← Back home</RouterLink>
    </div>

    <div class="stats-layout">
      <div class="stack">
        <div class="card">
          <h3 class="panel-title">Your stats</h3>
          <p v-if="myStatsLoading" class="text-muted">Loading…</p>
          <p v-else-if="myStatsError" class="error-text">{{ myStatsError }}</p>
          <p v-else-if="myStats.length === 0" class="text-muted">
            No finished games yet, {{ authStore.user?.displayName }} -- play one to
            start building your record.
          </p>
          <table v-else class="stats-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Played</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Win rate</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in myStats" :key="s.gameType.code">
                <td>{{ s.gameType.name }}</td>
                <td>{{ s.gamesPlayed }}</td>
                <td>{{ s.wins }}</td>
                <td>{{ s.losses }}</td>
                <td>{{ formatWinRate(s.winRate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h3 class="panel-title">Match history</h3>
          <p v-if="historyLoading" class="text-muted">Loading…</p>
          <p v-else-if="historyError" class="error-text">{{ historyError }}</p>
          <p v-else-if="history.length === 0" class="text-muted">
            Your finished games will show up here.
          </p>
          <template v-else>
            <div v-for="r in history" :key="r.id" class="history-row">
              <span class="history-outcome" :class="r.didWin ? 'history-win' : 'history-loss'">
                {{ r.didWin ? 'Won' : 'Lost' }}
              </span>
              <span>{{ r.gameType.name }}</span>
              <span class="text-muted"
                >{{ r.playerCount }} players<template v-if="!r.didWin && r.winner">
                  &middot; {{ r.winner.displayName }} won</template
                ></span
              >
              <span class="text-muted history-date">{{ formatDate(r.finishedAt) }}</span>
            </div>
            <div class="row" style="margin-top: 0.75rem">
              <button
                class="btn btn-secondary"
                :disabled="historyPage <= 1"
                @click="prevHistoryPage"
              >
                ← Newer
              </button>
              <button
                class="btn btn-secondary"
                :disabled="!hasMoreHistory"
                @click="nextHistoryPage"
              >
                Older →
              </button>
            </div>
          </template>
        </div>
      </div>

      <div class="card">
        <h3 class="panel-title">Leaderboard</h3>
        <div class="form-group">
          <label for="leaderboardGameType">Game</label>
          <select id="leaderboardGameType" v-model="leaderboardGameType">
            <option v-for="g in GAME_TYPES" :key="g.code" :value="g.code">
              {{ g.name }}
            </option>
          </select>
        </div>
        <p v-if="leaderboardLoading" class="text-muted">Loading…</p>
        <p v-else-if="leaderboardError" class="error-text">{{ leaderboardError }}</p>
        <p v-else-if="leaderboardEntries.length === 0" class="text-muted">
          No games finished for this game type yet.
        </p>
        <table v-else class="stats-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Wins</th>
              <th>Played</th>
              <th>Win rate</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in leaderboardEntries"
              :key="e.userId"
              :class="{ 'leaderboard-me': e.userId === authStore.user?.id }"
            >
              <td>{{ e.rank }}</td>
              <td>{{ e.displayName }}</td>
              <td>{{ e.wins }}</td>
              <td>{{ e.gamesPlayed }}</td>
              <td>{{ formatWinRate(e.winRate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-layout {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 1.25rem;
  align-items: start;
}

@media (max-width: 900px) {
  .stats-layout {
    grid-template-columns: 1fr;
  }
}

.panel-title {
  margin: 0 0 0.75rem;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.stats-table th,
.stats-table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.leaderboard-me {
  background: rgba(255, 217, 61, 0.1);
  font-weight: 700;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.88rem;
  flex-wrap: wrap;
}

.history-outcome {
  font-weight: 700;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
}

.history-win {
  background: rgba(56, 172, 106, 0.2);
  color: #3aa15c;
}

.history-loss {
  background: rgba(235, 77, 75, 0.15);
  color: #eb4d4b;
}

.history-date {
  margin-left: auto;
}
</style>
