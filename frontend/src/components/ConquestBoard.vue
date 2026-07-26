<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DiceRoller from "./DiceRoller.vue";
import {
  CONTINENTS,
  CONTINENT_COLORS,
  EDGE_LIST,
  TERRITORIES,
  TERRITORY_BY_ID,
  areAdjacent,
} from "./conquest/board-config";
import type { RoomPlayer } from "../types";
import type { ConquestCombatResult } from "../stores/room.store";

const props = defineProps<{
  boardState: Record<string, unknown>;
  players: RoomPlayer[];
  currentTurnSeat: number | null;
  mySeatIndex: number | null;
  lastCombat: (ConquestCombatResult & { id: number }) | null;
  hidePlayerSummary?: boolean;
}>();

const emit = defineEmits<{
  reinforce: [territoryId: string, count: number];
  attack: [fromId: string, toId: string, diceCount: number];
  "end-attack-phase": [];
  fortify: [fromId: string, toId: string, count: number];
  "end-turn": [];
}>();

interface ConquestPlayerState {
  seatIndex: number;
  eliminated: boolean;
}

interface ConquestStateShape {
  owner: Record<string, number>;
  armies: Record<string, number>;
  players: Record<number, ConquestPlayerState>;
  currentTurnSeat: number;
  phase: "reinforce" | "attack" | "fortify";
  reinforcementsRemaining: number;
}

const state = computed(() => props.boardState as unknown as ConquestStateShape | null);

const isMyTurn = computed(
  () => props.mySeatIndex != null && props.mySeatIndex === props.currentTurnSeat
);

const VIEW_W = 1000;
const VIEW_H = 780;

function playerColor(seatIndex: number | null): string {
  if (seatIndex == null) return "#999";
  return props.players.find((p) => p.seatIndex === seatIndex)?.color ?? "#999";
}

function nameForSeat(seatIndex: number | null): string {
  if (seatIndex == null) return "A player";
  return props.players.find((p) => p.seatIndex === seatIndex)?.displayName ?? "A player";
}

function ownerOf(territoryId: string): number | null {
  return state.value?.owner[territoryId] ?? null;
}

function armiesOn(territoryId: string): number {
  return state.value?.armies[territoryId] ?? 0;
}

function isEliminated(seatIndex: number): boolean {
  return state.value?.players[seatIndex]?.eliminated ?? false;
}

function territoryCountFor(seatIndex: number): number {
  return Object.values(state.value?.owner ?? {}).filter((s) => s === seatIndex).length;
}

function totalArmiesFor(seatIndex: number): number {
  const s = state.value;
  if (!s) return 0;
  return Object.entries(s.owner)
    .filter(([, owner]) => owner === seatIndex)
    .reduce((sum, [id]) => sum + (s.armies[id] ?? 0), 0);
}

const PHASE_LABEL: Record<string, string> = {
  reinforce: "Reinforce",
  attack: "Attack",
  fortify: "Fortify",
};

// Continents currently fully owned by a seat, for showing why their
// reinforcement count is bigger than the base territory-count math alone
// would suggest.
function continentsOwnedBy(seatIndex: number | null) {
  const s = state.value;
  if (!s || seatIndex == null) return [];
  return CONTINENTS.filter((c) =>
    TERRITORIES.filter((t) => t.continentId === c.id).every(
      (t) => s.owner[t.id] === seatIndex
    )
  );
}

const myContinentBonus = computed(() => {
  const owned = continentsOwnedBy(props.mySeatIndex);
  return {
    continents: owned,
    total: owned.reduce((sum, c) => sum + c.bonus, 0),
  };
});

// --- Layout ---

const nodePositions = computed(() =>
  TERRITORIES.map((t) => ({ ...t, cx: t.x * VIEW_W, cy: t.y * VIEW_H }))
);
const nodeById = computed(() =>
  Object.fromEntries(nodePositions.value.map((n) => [n.id, n]))
);

const edgeLines = computed(() =>
  EDGE_LIST.map(([a, b]) => ({
    a,
    b,
    x1: nodeById.value[a].cx,
    y1: nodeById.value[a].cy,
    x2: nodeById.value[b].cx,
    y2: nodeById.value[b].cy,
  }))
);

// Soft translucent backdrop per continent so the map reads as grouped
// regions rather than a bare dot graph.
const continentBlobs = computed(() =>
  CONTINENTS.map((c) => {
    const members = TERRITORIES.filter((t) => t.continentId === c.id);
    const cx = members.reduce((s, t) => s + t.x, 0) / members.length;
    const cy = members.reduce((s, t) => s + t.y, 0) / members.length;
    const r =
      Math.max(...members.map((t) => Math.hypot(t.x - cx, t.y - cy))) + 0.09;
    return {
      id: c.id,
      name: c.name,
      cx: cx * VIEW_W,
      cy: cy * VIEW_H,
      r: r * ((VIEW_W + VIEW_H) / 2),
      color: CONTINENT_COLORS[c.id],
    };
  })
);

// --- Selection / interaction ---

const selectedFrom = ref<string | null>(null);
const selectedTo = ref<string | null>(null);
const attackDiceCount = ref(1);
const fortifyCount = ref(1);

function clearSelection() {
  selectedFrom.value = null;
  selectedTo.value = null;
}

// Reset whenever the phase changes out from under a stale selection.
watch(
  () => state.value?.phase,
  () => clearSelection()
);

const maxAttackDice = computed(() => {
  if (!selectedFrom.value) return 1;
  return Math.max(1, Math.min(3, armiesOn(selectedFrom.value) - 1));
});
watch(maxAttackDice, (max) => {
  if (attackDiceCount.value > max) attackDiceCount.value = max;
});

const maxFortifyCount = computed(() => {
  if (!selectedFrom.value) return 1;
  return Math.max(1, armiesOn(selectedFrom.value) - 1);
});
watch(maxFortifyCount, (max) => {
  if (fortifyCount.value > max) fortifyCount.value = max;
});

const attackableTargets = computed(() => {
  if (state.value?.phase !== "attack" || !selectedFrom.value) return new Set<string>();
  const seat = props.mySeatIndex;
  const targets = new Set<string>();
  for (const id of Object.keys(state.value.owner)) {
    if (state.value.owner[id] === seat) continue;
    if (areAdjacent(selectedFrom.value, id)) targets.add(id);
  }
  return targets;
});

function onTerritoryClick(territoryId: string) {
  if (!isMyTurn.value) return;
  const s = state.value;
  if (!s) return;
  const seat = props.mySeatIndex;
  const mine = s.owner[territoryId] === seat;

  if (s.phase === "reinforce") {
    if (!mine || s.reinforcementsRemaining <= 0) return;
    emit("reinforce", territoryId, 1);
    return;
  }

  if (s.phase === "attack") {
    if (mine) {
      selectedFrom.value = armiesOn(territoryId) >= 2 ? territoryId : null;
      selectedTo.value = null;
      attackDiceCount.value = 1;
      return;
    }
    if (selectedFrom.value && attackableTargets.value.has(territoryId)) {
      selectedTo.value = territoryId;
    }
    return;
  }

  if (s.phase === "fortify") {
    if (!selectedFrom.value) {
      if (mine && armiesOn(territoryId) >= 2) selectedFrom.value = territoryId;
      return;
    }
    if (territoryId === selectedFrom.value) {
      selectedFrom.value = null;
      return;
    }
    if (mine) {
      selectedTo.value = territoryId;
      fortifyCount.value = 1;
    }
  }
}

function submitAttack() {
  if (!selectedFrom.value || !selectedTo.value) return;
  emit("attack", selectedFrom.value, selectedTo.value, attackDiceCount.value);
  selectedTo.value = null;
}

function submitFortify() {
  if (!selectedFrom.value || !selectedTo.value) return;
  emit("fortify", selectedFrom.value, selectedTo.value, fortifyCount.value);
  clearSelection();
}

function endAttackPhase() {
  clearSelection();
  emit("end-attack-phase");
}

function endTurn() {
  clearSelection();
  emit("end-turn");
}

// --- Battle result panel ---

const rollingCombat = ref(false);
watch(
  () => props.lastCombat?.id,
  (id) => {
    if (id == null) return;
    rollingCombat.value = true;
    window.setTimeout(() => {
      rollingCombat.value = false;
    }, 500);
  }
);

function nodeClasses(territoryId: string) {
  return {
    "cb-node-selected": territoryId === selectedFrom.value,
    "cb-node-target": territoryId === selectedTo.value,
    "cb-node-attackable": attackableTargets.value.has(territoryId),
  };
}
</script>

<template>
  <div class="conquest-wrap">
    <div class="conquest-main">
      <svg
        class="conquest-map"
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="cb-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="goo"
            />
          </filter>
        </defs>

        <!-- Original fictional landmasses (not a real-world map): each
             continent is a cluster of overlapping circles merged into one
             organic blob via an SVG goo filter, one blob group per
             continent so they read as solid regions rather than a bare
             node graph. -->
        <g v-for="c in CONTINENTS" :key="c.id" filter="url(#cb-goo)">
          <circle
            v-for="t in TERRITORIES.filter((t) => t.continentId === c.id)"
            :key="t.id"
            :cx="t.x * VIEW_W"
            :cy="t.y * VIEW_H"
            r="62"
            :fill="CONTINENT_COLORS[c.id]"
            class="cb-landmass"
          />
        </g>

        <line
          v-for="edge in edgeLines"
          :key="`${edge.a}-${edge.b}`"
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          class="cb-edge"
          :class="{ 'cb-edge-strait': nodeById[edge.a].continentId !== nodeById[edge.b].continentId }"
        />

        <g
          v-for="node in nodePositions"
          :key="node.id"
          :class="nodeClasses(node.id)"
          class="cb-node"
          @click="onTerritoryClick(node.id)"
        >
          <circle :cx="node.cx + 1.5" :cy="node.cy + 2.5" r="19" class="cb-node-shadow" />
          <circle
            :cx="node.cx"
            :cy="node.cy"
            r="19"
            :fill="playerColor(ownerOf(node.id))"
            class="cb-node-circle"
          />
          <ellipse :cx="node.cx - 6" :cy="node.cy - 7" rx="9" ry="6" class="cb-node-gloss" />
          <text :x="node.cx" :y="node.cy + 5" class="cb-node-armies">{{ armiesOn(node.id) }}</text>
          <text :x="node.cx" :y="node.cy + 32" class="cb-node-label">{{ node.name }}</text>
        </g>
      </svg>

      <div v-if="state" class="cb-status-bar">
        <span class="cb-status-dot" :style="{ background: playerColor(currentTurnSeat) }" />
        <strong>{{ nameForSeat(currentTurnSeat) }}</strong>
        <span class="cb-status-phase" :class="`cb-phase-${state.phase}`">{{
          PHASE_LABEL[state.phase]
        }}</span>
        <span v-if="state.phase === 'reinforce'" class="cb-status-pool">
          {{ isMyTurn ? state.reinforcementsRemaining : "" }}
        </span>
      </div>
    </div>

    <div class="conquest-side">
      <div v-if="!hidePlayerSummary" class="cb-players">
        <div
          v-for="p in players"
          :key="p.userId"
          class="cb-player-card"
          :class="{ 'cb-player-active': p.seatIndex === currentTurnSeat, 'cb-player-out': isEliminated(p.seatIndex) }"
          :style="{ '--player-color': p.color ?? '#999' }"
        >
          <span class="cb-player-avatar" :style="{ background: p.color ?? '#999' }">{{
            p.displayName.charAt(0).toUpperCase()
          }}</span>
          <div class="cb-player-info">
            <strong>{{ p.displayName }}</strong>
            <span v-if="isEliminated(p.seatIndex)" class="text-muted">💀 eliminated</span>
            <div v-else class="cb-player-stats">
              <span class="cb-stat">🚩 {{ territoryCountFor(p.seatIndex) }}</span>
              <span class="cb-stat">⚔️ {{ totalArmiesFor(p.seatIndex) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isMyTurn" class="card cb-action">
        <template v-if="state?.phase === 'reinforce'">
          <p><strong>Reinforce:</strong> click your territories to place armies.</p>
          <p class="text-muted">Remaining: {{ state.reinforcementsRemaining }}</p>
          <p v-if="myContinentBonus.total > 0" class="text-muted cb-bonus-note">
            Includes +{{ myContinentBonus.total }} for holding
            {{ myContinentBonus.continents.map((c) => c.name).join(", ") }}
          </p>
        </template>

        <template v-else-if="state?.phase === 'attack'">
          <p><strong>Attack:</strong> click a territory of yours with 2+ armies, then an adjacent enemy territory.</p>
          <div v-if="selectedFrom && selectedTo" class="cb-attack-picker">
            <p>
              {{ TERRITORY_BY_ID[selectedFrom]?.name }} &rarr;
              {{ TERRITORY_BY_ID[selectedTo]?.name }}
            </p>
            <div class="row">
              <label class="cb-inline-label">
                Dice
                <select v-model.number="attackDiceCount">
                  <option v-for="n in maxAttackDice" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
              <button class="btn btn-primary" @click="submitAttack">Attack!</button>
            </div>
          </div>
          <button class="btn btn-secondary" @click="endAttackPhase">End attack phase</button>
        </template>

        <template v-else-if="state?.phase === 'fortify'">
          <p><strong>Fortify:</strong> move armies once between territories you own, then your turn ends.</p>
          <div v-if="selectedFrom && selectedTo" class="cb-attack-picker">
            <p>
              {{ TERRITORY_BY_ID[selectedFrom]?.name }} &rarr;
              {{ TERRITORY_BY_ID[selectedTo]?.name }}
            </p>
            <div class="row">
              <label class="cb-inline-label">
                Armies
                <input
                  v-model.number="fortifyCount"
                  type="number"
                  min="1"
                  :max="maxFortifyCount"
                />
              </label>
              <button class="btn btn-primary" @click="submitFortify">Fortify &amp; end turn</button>
            </div>
          </div>
          <button class="btn btn-secondary" @click="endTurn">End turn without fortifying</button>
        </template>
      </div>
      <div v-else-if="state" class="card cb-action">
        <p class="text-muted">Waiting for {{ nameForSeat(currentTurnSeat) }} ({{ state.phase }})…</p>
      </div>

      <div v-if="lastCombat" class="card cb-battle">
        <h4 class="panel-title">
          ⚔️ {{ TERRITORY_BY_ID[lastCombat.fromId]?.name }} vs
          {{ TERRITORY_BY_ID[lastCombat.toId]?.name }}
        </h4>
        <div class="cb-battle-row">
          <div class="cb-dice-group">
            <span class="text-muted">Attacker</span>
            <div class="row">
              <DiceRoller
                v-for="(d, i) in lastCombat.attackerDice"
                :key="`a${i}`"
                :value="d"
                :is-rolling="rollingCombat"
              />
            </div>
          </div>
          <div class="cb-dice-group">
            <span class="text-muted">Defender</span>
            <div class="row">
              <DiceRoller
                v-for="(d, i) in lastCombat.defenderDice"
                :key="`d${i}`"
                :value="d"
                :is-rolling="rollingCombat"
              />
            </div>
          </div>
        </div>
        <p class="text-muted">
          Attacker lost {{ lastCombat.attackerLosses }}, defender lost {{ lastCombat.defenderLosses }}.
          <template v-if="lastCombat.captured">Territory captured!</template>
        </p>
      </div>

      <div class="card cb-legend">
        <h4 class="panel-title">Continents</h4>
        <div v-for="c in CONTINENTS" :key="c.id" class="cb-legend-row">
          <span class="cb-legend-swatch" :style="{ background: CONTINENT_COLORS[c.id] }" />
          {{ c.name }}
          <span class="text-muted">+{{ c.bonus }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conquest-wrap {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: flex-start;
}

.conquest-main {
  flex: 1 1 560px;
  min-width: 280px;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.conquest-map {
  width: 100%;
  aspect-ratio: 1000 / 780;
  background: radial-gradient(ellipse at 50% 40%, #1c2b45, #0f1524);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

.cb-landmass {
  opacity: 0.62;
}

.cb-edge {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}

.cb-edge-strait {
  stroke: rgba(255, 255, 255, 0.55);
  stroke-width: 2;
}

.cb-node {
  cursor: pointer;
}

.cb-node-shadow {
  fill: rgba(0, 0, 0, 0.45);
}

.cb-node-circle {
  stroke: rgba(0, 0, 0, 0.45);
  stroke-width: 2;
  transition: r 0.15s ease;
}

.cb-node-gloss {
  fill: rgba(255, 255, 255, 0.4);
  pointer-events: none;
}

.cb-node:hover .cb-node-circle {
  stroke: rgba(255, 255, 255, 0.85);
}

.cb-node-selected .cb-node-circle {
  stroke: #ffd93d;
  stroke-width: 4;
}

.cb-node-target .cb-node-circle {
  stroke: #ff6b6b;
  stroke-width: 4;
}

.cb-node-attackable .cb-node-circle {
  stroke-dasharray: 3 2;
  stroke: #ffd93d;
  stroke-width: 2.5;
}

.cb-node-armies {
  font-size: 16px;
  font-weight: 800;
  fill: #fff;
  text-anchor: middle;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 3;
  pointer-events: none;
}

.cb-node-label {
  font-size: 11px;
  fill: #fff;
  text-anchor: middle;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.75);
  stroke-width: 2.5;
}

.cb-status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

.cb-status-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cb-status-phase {
  margin-left: auto;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
}

.cb-phase-reinforce {
  background: rgba(56, 172, 106, 0.25);
  color: #4ade80;
}

.cb-phase-attack {
  background: rgba(235, 77, 75, 0.25);
  color: #f87171;
}

.cb-phase-fortify {
  background: rgba(52, 85, 219, 0.25);
  color: #60a5fa;
}

.cb-status-pool {
  min-width: 2.2rem;
  height: 2.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #a78bfa, #6d28d9);
  color: #fff;
  font-weight: 800;
  font-size: 0.9rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
}

.conquest-side {
  flex: 0 0 260px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.panel-title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.cb-players {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.cb-player-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--player-color, #999);
}

.cb-player-active {
  background: rgba(147, 51, 234, 0.18);
}

.cb-player-out {
  opacity: 0.55;
}

.cb-player-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  font-size: 0.85rem;
  box-shadow: inset 0 -2px 3px rgba(0, 0, 0, 0.3);
}

.cb-player-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.8rem;
  min-width: 0;
}

.cb-player-stats {
  display: flex;
  gap: 0.6rem;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.cb-stat {
  white-space: nowrap;
}

.cb-action {
  font-size: 0.85rem;
}

.cb-action p {
  margin: 0 0 0.4rem;
}

.cb-attack-picker {
  margin-bottom: 0.5rem;
}

.cb-inline-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.cb-inline-label input,
.cb-inline-label select {
  width: 4.5rem;
}

.cb-battle-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.4rem;
}

.cb-dice-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.cb-legend {
  font-size: 0.78rem;
}

.cb-legend-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.1rem 0;
}

.cb-legend-row .text-muted {
  margin-left: auto;
}

.cb-bonus-note {
  font-size: 0.72rem;
}

.cb-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .cb-node-label {
    display: none;
  }
}
</style>
