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
import { CONTINENT_PATHS } from "./conquest/continent-paths";
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

// Shared coordinate space with continent-paths.ts -- both are fitted to
// this exact size by the same map-generation script, so territory nodes
// (absolute x/y from board-config.ts, not fractions) land in the right
// place on the coastlines without any extra scaling here.
const VIEW_W = 1000;
const VIEW_H = 620;

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
  TERRITORIES.map((t) => ({ ...t, cx: t.x, cy: t.y }))
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
        <!-- Actual world coastlines, generated from public-domain Natural
             Earth geographic data (see continent-paths.ts) -- an original
             render of real geography, not traced from any game's art. -->
        <path
          v-for="c in CONTINENTS"
          :key="c.id"
          :d="CONTINENT_PATHS[c.id]"
          :fill="CONTINENT_COLORS[c.id]"
          class="cb-landmass"
        />

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

        <!-- Territory markers styled as little standing toy-soldier
             figures (original silhouette design -- head, torso, legs,
             shouldered rifle -- not traced from any commercial game's
             miniature sculpts) instead of flat circles, echoing how a
             physical board game marks armies with standee pieces. -->
        <g
          v-for="(node, nodeIndex) in nodePositions"
          :key="node.id"
          :class="nodeClasses(node.id)"
          class="cb-node"
          :transform="`translate(${node.cx}, ${node.cy})`"
          @click="onTerritoryClick(node.id)"
        >
          <title>{{ node.name }}</title>
          <circle cx="0" cy="0" r="8" class="cb-node-plinth" />
          <ellipse cx="0" cy="5.4" rx="3.6" ry="1.3" class="cb-soldier-shadow" />
          <g class="cb-soldier" :fill="playerColor(ownerOf(node.id))">
            <path class="cb-soldier-leg" d="M-1.9 5.2 L-0.9 -1 L-0.1 -1 L-0.6 5.2 Z" />
            <path class="cb-soldier-leg" d="M1.9 5.2 L0.9 -1 L0.1 -1 L0.6 5.2 Z" />
            <path
              class="cb-soldier-body"
              d="M-2.3 -1 C-2.6 -4.6 -1.6 -6 0 -6 C1.6 -6 2.6 -4.6 2.3 -1 Z"
            />
            <line class="cb-soldier-rifle" x1="-3.4" y1="-7.2" x2="2.1" y2="-0.6" />
            <circle class="cb-soldier-head" cx="0" cy="-7" r="1.7" />
          </g>
          <circle
            cx="4.2"
            cy="3.4"
            r="3.6"
            class="cb-node-armybadge"
            :style="{ '--player-color': playerColor(ownerOf(node.id)) }"
          />
          <text x="4.2" y="4.9" class="cb-node-armies">{{ armiesOn(node.id) }}</text>
          <!-- Alternating vertical offset breaks label collisions between
               neighbors that happen to share almost the same y (a few real
               -world clusters, e.g. Ironridge/Cragmoor, do). -->
          <text x="0" :y="nodeIndex % 2 === 0 ? -13 : -10.5" class="cb-node-label">{{ node.name }}</text>
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
  aspect-ratio: 1000 / 620;
  background: radial-gradient(ellipse at 50% 40%, #1c2b45, #0f1524);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

.cb-landmass {
  fill-opacity: 0.85;
  stroke: rgba(0, 0, 0, 0.45);
  stroke-width: 0.75;
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

.cb-node-plinth {
  fill: rgba(0, 0, 0, 0.28);
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 0.75;
  transition:
    stroke 0.15s ease,
    stroke-width 0.15s ease;
}

.cb-soldier-shadow {
  fill: rgba(0, 0, 0, 0.4);
}

.cb-soldier path,
.cb-soldier circle {
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 0.4;
}

.cb-soldier-rifle {
  stroke: #3a3a3a;
  stroke-width: 0.9;
  stroke-linecap: round;
}

.cb-node:hover .cb-node-plinth {
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 1.5;
}

.cb-node-selected .cb-node-plinth {
  stroke: #ffd93d;
  stroke-width: 2.5;
}

.cb-node-target .cb-node-plinth {
  stroke: #ff6b6b;
  stroke-width: 2.5;
}

.cb-node-attackable .cb-node-plinth {
  stroke-dasharray: 2 1.5;
  stroke: #ffd93d;
  stroke-width: 1.75;
}

.cb-node-armybadge {
  fill: #1a2033;
  stroke: var(--player-color, #999);
  stroke-width: 1;
}

.cb-node-armies {
  font-size: 6.5px;
  font-weight: 800;
  fill: #fff;
  text-anchor: middle;
  pointer-events: none;
}

.cb-node-label {
  font-size: 6.2px;
  font-weight: 600;
  fill: #fff;
  text-anchor: middle;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.85);
  stroke-width: 1.75;
  opacity: 0.9;
  transition: opacity 0.1s ease;
}

.cb-node:hover .cb-node-label,
.cb-node-selected .cb-node-label,
.cb-node-target .cb-node-label {
  opacity: 1;
  font-size: 9px;
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
    font-size: 6px;
  }
}
</style>
