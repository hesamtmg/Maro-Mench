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
  type CardDef,
} from "./conquest/board-config";
import { CONTINENT_PATHS } from "./conquest/continent-paths";
import { TERRITORY_PATHS } from "./conquest/territory-paths";
import type { RoomPlayer } from "../types";
import type { ConquestCombatResult } from "../stores/room.store";
import { playHooray } from "../lib/game-sounds";

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
  "reset-reinforcements": [];
  "move-armies": [fromId: string, toId: string, count: number];
  attack: [fromId: string, toId: string, diceCount: number];
  "occupy-captured": [additionalCount: number];
  "end-attack-phase": [];
  "end-turn": [];
  "trade-cards": [cardIds: string[]];
  "pass-turn": [];
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
  reinforcementsPlacedThisTurn: Record<string, number>;
  hands: Record<number, CardDef[]>;
  cardsTradedInCount: number;
  lastCaptureFromId: string | null;
  lastCaptureToId: string | null;
}

// Client-side mirror of the backend's escalating trade-in bonus schedule
// -- for display only (a "next trade is worth +N" preview); the server
// re-derives and enforces the real value.
const TRADE_IN_BASE_BONUSES = [4, 6, 8, 10, 12, 15];
function previewTradeBonus(tradeInIndex: number): number {
  if (tradeInIndex < TRADE_IN_BASE_BONUSES.length) return TRADE_IN_BASE_BONUSES[tradeInIndex];
  const last = TRADE_IN_BASE_BONUSES[TRADE_IN_BASE_BONUSES.length - 1];
  return last + 5 * (tradeInIndex - TRADE_IN_BASE_BONUSES.length + 1);
}

const CARD_SYMBOL_ICON: Record<string, string> = {
  infantry: "🪖",
  cavalry: "🐎",
  artillery: "💥",
  wild: "🃏",
};

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

// --- Zoom / pan ---
// The map defaults to showing the whole world, which makes labels and
// army counts tiny on anything but a large screen. Deliberately no
// scroll-wheel zoom -- it fights the page's own scrolling and surprises
// people who just meant to scroll past the map. Zoom is drag/gesture only:
// pinch (toward the pinch midpoint) or the +/-/reset buttons, and drag to
// pan around. This only changes the SVG's viewBox -- territory click
// targets are unaffected, since SVG hit-testing works in the element's own
// coordinate space regardless of how the viewBox is currently framed.
const svgRef = ref<SVGSVGElement | null>(null);
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const zoom = ref(MIN_ZOOM);
const viewX = ref(0);
const viewY = ref(0);
const viewW = computed(() => VIEW_W / zoom.value);
const viewH = computed(() => VIEW_H / zoom.value);
const viewBoxStr = computed(
  () => `${viewX.value} ${viewY.value} ${viewW.value} ${viewH.value}`
);

function clampView() {
  viewX.value = Math.max(0, Math.min(VIEW_W - viewW.value, viewX.value));
  viewY.value = Math.max(0, Math.min(VIEW_H - viewH.value, viewY.value));
}

function svgPointFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = svgRef.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

// Re-centers the view on `newZoom` while keeping the given world point
// fixed at whatever screen position it currently occupies -- shared by
// wheel-zoom, the +/- buttons, and (per-frame) pinch-zoom. Unlike a
// simple "zoom around the center" this also naturally handles two-finger
// panning: feeding it the *current* world point under the pinch midpoint
// every frame, even when the zoom level barely changes, re-centers the
// view to follow the fingers.
function applyZoomAnchored(newZoomRaw: number, anchor: { x: number; y: number }) {
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoomRaw));
  const fx = (anchor.x - viewX.value) / viewW.value;
  const fy = (anchor.y - viewY.value) / viewH.value;
  const newW = VIEW_W / newZoom;
  const newH = VIEW_H / newZoom;
  viewX.value = anchor.x - fx * newW;
  viewY.value = anchor.y - fy * newH;
  zoom.value = newZoom;
  clampView();
}

function zoomTo(newZoomRaw: number, anchor?: { x: number; y: number }) {
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoomRaw));
  if (newZoom === zoom.value) return;
  const point = anchor ?? { x: viewX.value + viewW.value / 2, y: viewY.value + viewH.value / 2 };
  applyZoomAnchored(newZoom, point);
}

function zoomInButton() {
  zoomTo(zoom.value * 1.5);
}

function zoomOutButton() {
  zoomTo(zoom.value / 1.5);
}

// Double-click zooms in centered on the click point (standard map
// convention). Deliberately not double-tap on touch -- that's better left
// for a future pinch-follow-up, and a stray double-tap while trying to
// select two territories quickly shouldn't suddenly zoom the map.
function onMapDoubleClick(evt: MouseEvent) {
  const anchor = svgPointFromClient(evt.clientX, evt.clientY);
  zoomTo(zoom.value * 1.75, anchor ?? undefined);
}

const isPanning = ref(false);
// True once a pointer-down-then-move exceeds a small threshold -- lets
// onTerritoryClick tell a real drag/pinch apart from a tap/click that
// happens to fire right after pointerup.
const dragMoved = ref(false);
// clientX/Y per active pointer id -- one entry while dragging with a
// single finger/mouse, two while pinching.
const activePointers = new Map<number, { x: number; y: number }>();
let panPointerId: number | null = null;
let lastPointer = { x: 0, y: 0 };
let downPointer = { x: 0, y: 0 };
let pinchLastDist: number | null = null;

function pinchDistance(): number {
  const [a, b] = [...activePointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pinchMidpoint(): { x: number; y: number } {
  const [a, b] = [...activePointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function startSinglePointerPan(id: number, pos: { x: number; y: number }) {
  panPointerId = id;
  lastPointer = pos;
  downPointer = pos;
  isPanning.value = zoom.value > MIN_ZOOM;
}

function onMapPointerDown(evt: PointerEvent) {
  // Deliberately NOT calling setPointerCapture here: capturing on every
  // pointerdown -- even a plain click that never moves -- makes Chromium
  // retarget the resulting "click" event to the capturing element (the
  // svg) instead of the territory <g> the user actually clicked, so
  // territory selection silently stops working. Capture is instead
  // acquired lazily in onMapPointerMove, only once a real drag/pinch is
  // detected.
  activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
  dragMoved.value = false;

  if (activePointers.size === 2) {
    isPanning.value = false;
    pinchLastDist = pinchDistance();
  } else if (activePointers.size === 1) {
    startSinglePointerPan(evt.pointerId, { x: evt.clientX, y: evt.clientY });
  }
}

function onMapPointerMove(evt: PointerEvent) {
  if (!activePointers.has(evt.pointerId)) return;
  activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });

  if (activePointers.size >= 2) {
    if (!dragMoved.value) svgRef.value?.setPointerCapture(evt.pointerId);
    const dist = pinchDistance();
    const mid = pinchMidpoint();
    const anchor = svgPointFromClient(mid.x, mid.y);
    if (anchor && pinchLastDist) {
      applyZoomAnchored(zoom.value * (dist / pinchLastDist), anchor);
    }
    pinchLastDist = dist;
    dragMoved.value = true;
    return;
  }

  if (!isPanning.value || evt.pointerId !== panPointerId) return;
  const svg = svgRef.value;
  if (!svg) return;
  if (Math.abs(evt.clientX - downPointer.x) > 4 || Math.abs(evt.clientY - downPointer.y) > 4) {
    if (!dragMoved.value) svg.setPointerCapture(evt.pointerId);
    dragMoved.value = true;
  }
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dx = ((evt.clientX - lastPointer.x) / rect.width) * viewW.value;
  const dy = ((evt.clientY - lastPointer.y) / rect.height) * viewH.value;
  viewX.value -= dx;
  viewY.value -= dy;
  clampView();
  lastPointer = { x: evt.clientX, y: evt.clientY };
}

function onMapPointerUp(evt: PointerEvent) {
  activePointers.delete(evt.pointerId);
  if (activePointers.size < 2) pinchLastDist = null;
  if (evt.pointerId === panPointerId) {
    isPanning.value = false;
    panPointerId = null;
  }
  // One finger left after a pinch -- hand off to single-pointer panning
  // instead of just stopping, so lifting the second finger doesn't
  // abruptly end the gesture.
  if (activePointers.size === 1) {
    const [[id, pos]] = activePointers;
    startSinglePointerPan(id, pos);
  }
}

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

// Every territory carries a military rank based on its army count, shown as
// a chevron-striped badge on the map (highest min first so the first match
// wins; min: 0 means every count matches something).
const ARMY_RANK_TIERS: { min: number; name: string; color: string; level: number }[] = [
  { min: 15, name: "Colonel", color: "#4169e1", level: 4 },
  { min: 10, name: "Major", color: "#ffd700", level: 3 },
  { min: 5, name: "Captain", color: "#c0c0c0", level: 2 },
  { min: 0, name: "Sergeant", color: "#cd7f32", level: 1 },
];
function armyRankFor(count: number): { name: string; color: string; level: number } {
  return (
    ARMY_RANK_TIERS.find((tier) => count >= tier.min) ??
    ARMY_RANK_TIERS[ARMY_RANK_TIERS.length - 1]
  );
}
const armyRankByTerritory = computed(() => {
  const map: Record<string, { name: string; color: string; level: number }> = {};
  for (const t of TERRITORIES) map[t.id] = armyRankFor(armiesOn(t.id));
  return map;
});

// Small chevron stripes drawn inside the rank badge -- one per rank level,
// stacked and centered on the badge.
function chevronPath(cx: number, cy: number): string {
  return `M ${cx - 1.5} ${cy + 0.55} L ${cx} ${cy - 0.55} L ${cx + 1.5} ${cy + 0.55}`;
}
function chevronOffsets(level: number): number[] {
  const spacing = 1.15;
  const start = -((level - 1) * spacing) / 2;
  return Array.from({ length: level }, (_, i) => start + i * spacing);
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

function territoriesOwnedBy(seatIndex: number | null) {
  const s = state.value;
  if (!s || seatIndex == null) return [];
  return TERRITORIES.filter((t) => s.owner[t.id] === seatIndex).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

// Which players' full territory list is expanded in the sidebar card --
// keyed by seatIndex, collapsed by default since a player can own up to
// all 42 territories.
const expandedTerritoriesFor = ref<Set<number>>(new Set());
function toggleTerritoriesExpanded(seatIndex: number) {
  const next = new Set(expandedTerritoriesFor.value);
  if (next.has(seatIndex)) next.delete(seatIndex);
  else next.add(seatIndex);
  expandedTerritoriesFor.value = next;
}

const myContinentBonus = computed(() => {
  const owned = continentsOwnedBy(props.mySeatIndex);
  return {
    continents: owned,
    total: owned.reduce((sum, c) => sum + c.bonus, 0),
  };
});

// Seat that fully owns each continent (for bolding its badge on the map),
// or null if the continent is split between two or more seats.
const continentFullOwners = computed(() => {
  const s = state.value;
  const map: Record<string, number | null> = {};
  for (const c of CONTINENTS) {
    if (!s) {
      map[c.id] = null;
      continue;
    }
    const members = TERRITORIES.filter((t) => t.continentId === c.id);
    const firstOwner = s.owner[members[0].id];
    map[c.id] =
      firstOwner != null && members.every((t) => s.owner[t.id] === firstOwner)
        ? firstOwner
        : null;
  }
  return map;
});

// Celebrate the moment *I* complete a continent (not when the opponent
// does, and not a re-trigger just from a re-render) with a one-shot sound.
// Tracked in a plain Set (not reactive state) since it's just local
// bookkeeping for "have I already played this one", re-armed if the
// continent is lost so recapturing it celebrates again.
const celebratedContinentIds = new Set<string>();
watch(
  () => myContinentBonus.value.continents.map((c) => c.id),
  (ownedIds) => {
    for (const id of ownedIds) {
      if (!celebratedContinentIds.has(id)) {
        celebratedContinentIds.add(id);
        playHooray();
      }
    }
    for (const id of [...celebratedContinentIds]) {
      if (!ownedIds.includes(id)) celebratedContinentIds.delete(id);
    }
  }
);

// --- Cards ---

const myHand = computed<CardDef[]>(() => {
  if (props.mySeatIndex == null) return [];
  return state.value?.hands?.[props.mySeatIndex] ?? [];
});

function cardCountFor(seatIndex: number): number {
  return state.value?.hands?.[seatIndex]?.length ?? 0;
}

const mustTradeIn = computed(() => myHand.value.length >= 5);

const selectedCardIds = ref<string[]>([]);

// Collapsed by default so the trophies panel doesn't sit over the map
// blocking territories -- the player opens it deliberately to check
// bonuses/schedules.
const trophiesOpen = ref(false);

// The battle log and hand panels live in the sidebar (not over the map),
// so they default open, but stay collapsible for anyone who wants a
// tidier sidebar.
const battleOpen = ref(true);
const myCardsOpen = ref(true);

// Clicking a selected card deselects it. Clicking a new card while 3 are
// already selected swaps out the oldest selection instead of silently
// doing nothing -- lets a player just click through the cards they want
// without having to manually deselect one first.
function toggleCard(cardId: string) {
  const i = selectedCardIds.value.indexOf(cardId);
  if (i !== -1) {
    selectedCardIds.value.splice(i, 1);
    return;
  }
  if (selectedCardIds.value.length >= 3) {
    selectedCardIds.value.shift();
  }
  selectedCardIds.value.push(cardId);
}

// Same-shape check as the backend's isValidCardSet -- purely for enabling
// the trade button early; the server re-validates and is authoritative.
const selectedSetIsValid = computed(() => {
  if (selectedCardIds.value.length !== 3) return false;
  const cards = selectedCardIds.value
    .map((id) => myHand.value.find((c) => c.id === id))
    .filter((c): c is CardDef => !!c);
  if (cards.length !== 3) return false;
  if (cards.some((c) => c.symbol === "wild")) return true;
  const [a, b, c] = cards.map((x) => x.symbol);
  return (a === b && b === c) || (a !== b && b !== c && a !== c);
});

const nextTradeBonus = computed(() => previewTradeBonus(state.value?.cardsTradedInCount ?? 0));

function territoryCountForContinent(continentId: string): number {
  return TERRITORIES.filter((t) => t.continentId === continentId).length;
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function submitTradeCards() {
  if (!selectedSetIsValid.value) return;
  emit("trade-cards", [...selectedCardIds.value]);
  selectedCardIds.value = [];
}

// --- Layout ---

const nodePositions = computed(() =>
  TERRITORIES.map((t) => ({ ...t, cx: t.x, cy: t.y }))
);
const nodeById = computed(() =>
  Object.fromEntries(nodePositions.value.map((n) => [n.id, n]))
);

// Bering Strait (icemark <-> sunset_bay) sits on opposite sides of this
// flat map, so drawn as one straight line it cuts a long diagonal clean
// across the whole board. Drawn instead as two short stubs pointing off
// their nearest edge, implying the connection wraps around behind the
// map -- same convention most Risk-style flat maps use for Alaska-
// Kamchatka -- rather than as a single line over everything in between.
const WRAP_EDGE_IDS: [string, string] = ["icemark", "sunset_bay"];
const WRAP_STUB_LENGTH = 22;

const edgeLines = computed(() =>
  EDGE_LIST.filter(
    ([a, b]) =>
      !(
        (a === WRAP_EDGE_IDS[0] && b === WRAP_EDGE_IDS[1]) ||
        (a === WRAP_EDGE_IDS[1] && b === WRAP_EDGE_IDS[0])
      )
  ).map(([a, b]) => ({
    a,
    b,
    x1: nodeById.value[a].cx,
    y1: nodeById.value[a].cy,
    x2: nodeById.value[b].cx,
    y2: nodeById.value[b].cy,
  }))
);

const wrapEdgeStubs = computed(() => {
  const [aId, bId] = WRAP_EDGE_IDS;
  const a = nodeById.value[aId];
  const b = nodeById.value[bId];
  if (!a || !b) return [];
  return [
    { key: `${aId}-wrap`, x1: a.cx, y1: a.cy, x2: Math.max(0, a.cx - WRAP_STUB_LENGTH), y2: a.cy },
    { key: `${bId}-wrap`, x1: b.cx, y1: b.cy, x2: Math.min(VIEW_W, b.cx + WRAP_STUB_LENGTH), y2: b.cy },
  ];
});

// One bonus badge per continent, floated just above that continent's
// northernmost territory (average x across its territories, so it centers
// over the landmass rather than sitting on any one node).
const continentLabelPositions = computed(() =>
  CONTINENTS.map((c) => {
    const members = TERRITORIES.filter((t) => t.continentId === c.id);
    const avgX = members.reduce((sum, t) => sum + t.x, 0) / members.length;
    const minY = Math.min(...members.map((t) => t.y));
    return { ...c, x: avgX, y: minY - 20 };
  })
);

// Lightens/darkens a #rrggbb color by `percent` (-100..100) -- used to turn
// each continent's flat base color into a highlight/shadow pair for the
// gradient that gives the landmass a subtle raised, globe-lit look.
function shadeColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round((percent / 100) * 255);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const continentGradientStops = computed(() =>
  CONTINENTS.map((c) => {
    const base = CONTINENT_COLORS[c.id];
    return { id: c.id, light: shadeColor(base, 28), base, dark: shadeColor(base, -30) };
  })
);

// --- Selection / interaction ---

const selectedFrom = ref<string | null>(null);
const selectedTo = ref<string | null>(null);
const attackDiceCount = ref(1);
const fortifyMoveCount = ref(1);

function clearSelection() {
  selectedFrom.value = null;
  selectedTo.value = null;
  fortifyMoveCount.value = 1;
}

// Reset whenever the phase changes out from under a stale selection.
watch(
  () => state.value?.phase,
  () => clearSelection()
);

const maxAttackDice = computed(() => {
  if (!selectedFrom.value) return 1;
  return Math.max(1, Math.min(3, armiesOn(selectedFrom.value)));
});
watch(maxAttackDice, (max) => {
  if (attackDiceCount.value > max) attackDiceCount.value = max;
});

const maxFortifyMoveCount = computed(() => {
  if (!selectedFrom.value) return 1;
  return Math.max(1, armiesOn(selectedFrom.value) - 1);
});
watch(maxFortifyMoveCount, (max) => {
  if (fortifyMoveCount.value > max) fortifyMoveCount.value = max;
});

// Lets a player keep attacking the same border with one click instead of
// re-picking both territories after every roll. Purely a convenience --
// the backend re-validates ownership/adjacency/army-counts regardless, so
// a stale lastCombat (e.g. from the opponent's last turn) just fails
// harmlessly if clicked instead of doing anything wrong.
const canContinueAttack = computed(() => {
  const lc = props.lastCombat;
  if (!lc || !isMyTurn.value || state.value?.phase !== "attack") return false;
  if (ownerOf(lc.fromId) !== props.mySeatIndex) return false;
  if (ownerOf(lc.toId) === props.mySeatIndex) return false;
  return armiesOn(lc.fromId) >= 2;
});

function continueAttacking() {
  const lc = props.lastCombat;
  if (!lc || !canContinueAttack.value) return;
  const dice = Math.max(1, Math.min(3, armiesOn(lc.fromId)));
  emit("attack", lc.fromId, lc.toId, dice);
}

// --- Occupying a just-captured territory with more than the minimum ---
// Classic Risk choice: right after a capture, move in more armies than
// the automatic minimum (attacker dice count), as long as at least one
// stays behind. Only available until the next attack roll or leaving the
// attack phase (see ConquestState.lastCaptureFromId/ToId on the backend).
const occupyCount = ref(1);
const pendingOccupation = computed(() => {
  const s = state.value;
  if (!s || !isMyTurn.value || s.phase !== "attack") return null;
  if (!s.lastCaptureFromId || !s.lastCaptureToId) return null;
  if (ownerOf(s.lastCaptureFromId) !== props.mySeatIndex) return null;
  return { fromId: s.lastCaptureFromId, toId: s.lastCaptureToId };
});
const maxOccupyCount = computed(() => {
  const p = pendingOccupation.value;
  if (!p) return 1;
  return Math.max(1, armiesOn(p.fromId) - 1);
});
watch(maxOccupyCount, (max) => {
  if (occupyCount.value > max) occupyCount.value = max;
});
watch(pendingOccupation, (p) => {
  if (p) occupyCount.value = 1;
});

function submitOccupyCaptured() {
  if (!pendingOccupation.value) return;
  emit("occupy-captured", occupyCount.value);
}

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
  if (dragMoved.value) return;
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
      fortifyMoveCount.value = 1;
    }
  }
}

function submitAttack() {
  if (!selectedFrom.value || !selectedTo.value) return;
  emit("attack", selectedFrom.value, selectedTo.value, attackDiceCount.value);
  selectedTo.value = null;
}

function submitFortifyMove() {
  if (!selectedFrom.value || !selectedTo.value) return;
  emit("move-armies", selectedFrom.value, selectedTo.value, fortifyMoveCount.value);
  selectedFrom.value = null;
  selectedTo.value = null;
  fortifyMoveCount.value = 1;
}

function endAttackPhase() {
  clearSelection();
  emit("end-attack-phase");
}

function endTurn() {
  clearSelection();
  emit("end-turn");
}

// Voluntary version of the turn-timeout scheduler's stall protection --
// auto-places any leftover reinforcements on the strongest territory and
// ends the turn immediately, from any phase. Useful now that the actual
// timeout is 10 minutes: a player who's done for the turn shouldn't have
// to wait that long just to hand off.
function passTurn() {
  clearSelection();
  emit("pass-turn");
}

const canResetReinforcements = computed(
  () => Object.keys(state.value?.reinforcementsPlacedThisTurn ?? {}).length > 0
);

function resetReinforcements() {
  emit("reset-reinforcements");
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
      <div class="cb-map-wrap">
      <svg
        ref="svgRef"
        class="conquest-map"
        :class="{ 'cb-map-panning': isPanning }"
        :viewBox="viewBoxStr"
        preserveAspectRatio="xMidYMid meet"
        @pointerdown="onMapPointerDown"
        @pointermove="onMapPointerMove"
        @pointerup="onMapPointerUp"
        @pointercancel="onMapPointerUp"
        @dblclick="onMapDoubleClick"
      >
        <!-- Per-continent highlight/shadow gradient + a shared drop-shadow
             filter give the flat landmass fills a subtly raised, globe-lit
             look instead of flat color fills. -->
        <defs>
          <radialGradient
            v-for="g in continentGradientStops"
            :id="`cb-continent-grad-${g.id}`"
            :key="`grad-${g.id}`"
            cx="35%"
            cy="30%"
            r="85%"
            gradientUnits="objectBoundingBox"
          >
            <stop offset="0%" :stop-color="g.light" />
            <stop offset="55%" :stop-color="g.base" />
            <stop offset="100%" :stop-color="g.dark" />
          </radialGradient>
          <filter id="cb-landmass-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.4" stdDeviation="1.6" flood-color="#000" flood-opacity="0.45" />
          </filter>
        </defs>

        <!-- Actual world coastlines, generated from public-domain Natural
             Earth geographic data (see continent-paths.ts) -- an original
             render of real geography, not traced from any game's art. -->
        <path
          v-for="c in CONTINENTS"
          :key="c.id"
          :d="CONTINENT_PATHS[c.id]"
          :fill="`url(#cb-continent-grad-${c.id})`"
          filter="url(#cb-landmass-shadow)"
          class="cb-landmass"
        />

        <!-- Per-territory boundary polygons -- Voronoi-tessellated around
             each territory's node and clipped to the real coastline (see
             territory-paths.ts), tinted by whoever currently owns it so
             ownership reads at a glance instead of just from the node
             markers. Sits over the continent's 3D-shaded base fill, which
             still shows through the tint. -->
        <path
          v-for="t in TERRITORIES"
          :key="`boundary-${t.id}`"
          :d="TERRITORY_PATHS[t.id]"
          :fill="playerColor(ownerOf(t.id))"
          class="cb-territory-boundary"
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

        <!-- Bering Strait: two short stubs pointing off the map edge
             instead of one long line across the board -- see
             wrapEdgeStubs above. -->
        <line
          v-for="stub in wrapEdgeStubs"
          :key="stub.key"
          :x1="stub.x1"
          :y1="stub.y1"
          :x2="stub.x2"
          :y2="stub.y2"
          class="cb-edge cb-edge-strait cb-edge-wrap-stub"
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
          <title>{{ node.name }} — {{ armyRankByTerritory[node.id].name }}</title>
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
          <!-- Rank badge: a chevron-striped insignia on the left, mirroring
               the army-count badge on the right. Chevron count == rank
               level (1 Sergeant .. 4 Colonel). -->
          <g class="cb-rank-badge" :style="{ '--rank-color': armyRankByTerritory[node.id].color }">
            <circle cx="-4.2" cy="3.4" r="3.6" class="cb-node-rankbadge" />
            <path
              v-for="(dy, i) in chevronOffsets(armyRankByTerritory[node.id].level)"
              :key="i"
              :d="chevronPath(-4.2, 3.4 + dy)"
              class="cb-rank-chevron"
            />
          </g>
          <circle
            cx="4.2"
            cy="3.4"
            r="3.6"
            class="cb-node-armybadge"
            :style="{ '--rank-color': armyRankByTerritory[node.id].color }"
          />
          <text x="4.2" y="4.9" class="cb-node-armies">{{ armiesOn(node.id) }}</text>
          <!-- Alternating vertical offset breaks label collisions between
               neighbors that happen to share almost the same y (a few real
               -world clusters, e.g. Etruria/Illyria, do). -->
          <text x="0" :y="nodeIndex % 2 === 0 ? -13 : -10.5" class="cb-node-label">{{ node.name }}</text>
        </g>

        <!-- Continent bonus badges, floated above each landmass. -->
        <g
          v-for="c in continentLabelPositions"
          :key="`badge-${c.id}`"
          :transform="`translate(${c.x}, ${c.y})`"
          class="cb-continent-badge"
          :class="{ 'cb-continent-badge-owned': continentFullOwners[c.id] != null }"
        >
          <rect
            x="-15"
            y="-8"
            width="30"
            height="16"
            rx="4"
            :fill="continentFullOwners[c.id] != null ? playerColor(continentFullOwners[c.id]) : CONTINENT_COLORS[c.id]"
          />
          <text x="0" y="4" class="cb-continent-badge-text">+{{ c.bonus }}</text>
        </g>
      </svg>

      <div class="cb-watermark">🌍 Conquest</div>

      <div class="cb-zoom-controls">
        <button type="button" class="cb-zoom-btn" aria-label="Zoom in" title="Zoom in" @click="zoomInButton">+</button>
        <button type="button" class="cb-zoom-btn" aria-label="Zoom out" title="Zoom out" @click="zoomOutButton">&minus;</button>
      </div>

      <div v-if="state" class="cb-trophies-float">
        <button
          type="button"
          class="cb-trophies-toggle"
          :aria-expanded="trophiesOpen"
          @click="trophiesOpen = !trophiesOpen"
        >
          <span>🏆 Trophies</span>
          <span class="cb-trophies-chevron">{{ trophiesOpen ? "▾" : "▸" }}</span>
        </button>

        <div v-if="trophiesOpen" class="cb-trophies-body">
          <p class="cb-trophies-subtitle">Continents -- own every territory for the bonus</p>
          <table class="cb-table">
            <thead>
              <tr>
                <th>Continent</th>
                <th>Terr.</th>
                <th>Bonus</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in CONTINENTS" :key="c.id">
                <td class="cb-table-continent">
                  <span class="cb-legend-swatch" :style="{ background: CONTINENT_COLORS[c.id] }" />
                  {{ c.name }}
                </td>
                <td>{{ territoryCountForContinent(c.id) }}</td>
                <td>+{{ c.bonus }}</td>
              </tr>
            </tbody>
          </table>

          <p class="cb-trophies-subtitle">Card sets -- trade in 3 for a growing bonus</p>
          <table class="cb-table">
            <thead>
              <tr>
                <th>Set #</th>
                <th>Bonus</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="n in 7"
                :key="n"
                :class="{ 'cb-table-next': state?.cardsTradedInCount === n - 1 }"
              >
                <td>{{ n }}{{ ordinalSuffix(n) }}</td>
                <td>+{{ previewTradeBonus(n - 1) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="text-muted cb-trophies-note">Every set after the 6th is worth +5 more than the last.</p>
        </div>
      </div>
      </div>

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
            <template v-else>
              <div class="cb-player-stats">
                <span class="cb-stat">🚩 {{ territoryCountFor(p.seatIndex) }}</span>
                <span class="cb-stat">⚔️ {{ totalArmiesFor(p.seatIndex) }}</span>
              </div>
              <p v-if="continentsOwnedBy(p.seatIndex).length > 0" class="cb-player-continents">
                🌎 {{ continentsOwnedBy(p.seatIndex).map((c) => c.name).join(", ") }}
              </p>
              <button
                type="button"
                class="cb-player-territories-toggle"
                @click="toggleTerritoriesExpanded(p.seatIndex)"
              >
                {{ expandedTerritoriesFor.has(p.seatIndex) ? "Hide" : "Show" }} territories
                {{ expandedTerritoriesFor.has(p.seatIndex) ? "▾" : "▸" }}
              </button>
              <p v-if="expandedTerritoriesFor.has(p.seatIndex)" class="cb-player-territories-list">
                {{ territoriesOwnedBy(p.seatIndex).map((t) => t.name).join(", ") }}
              </p>
            </template>
          </div>
        </div>
      </div>

      <div v-if="isMyTurn" class="card cb-action">
        <template v-if="state?.phase === 'reinforce'">
          <p v-if="mustTradeIn" class="cb-must-trade">
            🃏 You have {{ myHand.length }} cards -- trade in a set below before placing reinforcements.
          </p>
          <p><strong>Reinforce:</strong> click your territories to place armies.</p>
          <p class="text-muted">Remaining: {{ state.reinforcementsRemaining }}</p>
          <p v-if="myContinentBonus.total > 0" class="text-muted cb-bonus-note">
            Includes +{{ myContinentBonus.total }} for holding
            {{ myContinentBonus.continents.map((c) => c.name).join(", ") }}
          </p>
          <button
            v-if="canResetReinforcements"
            class="btn btn-secondary cb-reset-btn"
            title="Undo every army you've placed this turn and return them to your pool"
            @click="resetReinforcements"
          >
            ↩️ Reset reinforcements
          </button>
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
          <p>
            <strong>Fortify:</strong> click a territory of yours with 2+ armies, then another
            territory of yours -- repeat as many times as you like, then end your turn.
          </p>
          <div v-if="selectedFrom && selectedTo" class="cb-attack-picker">
            <p>
              {{ TERRITORY_BY_ID[selectedFrom]?.name }} &rarr;
              {{ TERRITORY_BY_ID[selectedTo]?.name }}
            </p>
            <div class="row">
              <input
                v-model.number="fortifyMoveCount"
                type="number"
                min="1"
                :max="maxFortifyMoveCount"
                class="cb-move-count"
              />
              <button class="btn btn-primary" @click="submitFortifyMove">Move</button>
            </div>
          </div>

          <button class="btn btn-primary cb-end-turn-btn" @click="endTurn">End turn</button>
        </template>

        <button class="btn btn-secondary cb-pass-btn" title="Auto-place any leftover reinforcements and hand off immediately" @click="passTurn">
          ⏭️ Pass turn
        </button>
      </div>
      <div v-else-if="state" class="card cb-action">
        <p class="text-muted">Waiting for {{ nameForSeat(currentTurnSeat) }} ({{ state.phase }})…</p>
      </div>

      <div v-if="lastCombat" class="card cb-battle">
        <button
          type="button"
          class="cb-panel-toggle"
          :aria-expanded="battleOpen"
          @click="battleOpen = !battleOpen"
        >
          <h4 class="panel-title cb-panel-toggle-title">
            ⚔️ {{ TERRITORY_BY_ID[lastCombat.fromId]?.name }} vs
            {{ TERRITORY_BY_ID[lastCombat.toId]?.name }}
          </h4>
          <span class="cb-panel-toggle-chevron">{{ battleOpen ? "▾" : "▸" }}</span>
        </button>
        <template v-if="battleOpen">
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

          <div v-if="pendingOccupation" class="cb-occupy-more">
            <p>
              <strong>Occupy {{ TERRITORY_BY_ID[pendingOccupation.toId]?.name }}:</strong>
              move more armies in from {{ TERRITORY_BY_ID[pendingOccupation.fromId]?.name }}
              ({{ armiesOn(pendingOccupation.fromId) }} there now).
            </p>
            <div class="row">
              <input
                v-model.number="occupyCount"
                type="number"
                min="1"
                :max="maxOccupyCount"
                class="cb-move-count"
              />
              <button class="btn btn-primary" @click="submitOccupyCaptured">Move in</button>
            </div>
          </div>

          <button
            v-if="canContinueAttack"
            class="btn btn-primary cb-continue-attack-btn"
            @click="continueAttacking"
          >
            ⚔️ Continue attacking
          </button>
        </template>
      </div>

      <div class="card cb-cards">
        <button
          type="button"
          class="cb-panel-toggle"
          :aria-expanded="myCardsOpen"
          @click="myCardsOpen = !myCardsOpen"
        >
          <h4 class="panel-title cb-panel-toggle-title">Your Cards</h4>
          <span class="cb-panel-toggle-chevron">{{ myCardsOpen ? "▾" : "▸" }}</span>
        </button>
        <template v-if="myCardsOpen">
          <p v-if="myHand.length === 0" class="text-muted">
            None yet -- capture a territory during your attack phase to draw one.
          </p>
          <div v-else class="cb-hand">
            <button
              v-for="c in myHand"
              :key="c.id"
              type="button"
              class="cb-card"
              :class="{ 'cb-card-selected': selectedCardIds.includes(c.id) }"
              :disabled="!isMyTurn || state?.phase !== 'reinforce'"
              @click="toggleCard(c.id)"
            >
              <span class="cb-card-icon">{{ CARD_SYMBOL_ICON[c.symbol] }}</span>
              <span class="cb-card-name">{{ c.territoryId ? TERRITORY_BY_ID[c.territoryId]?.name : "Wild" }}</span>
            </button>
          </div>
          <button
            v-if="isMyTurn && state?.phase === 'reinforce'"
            class="btn btn-primary cb-trade-btn"
            :disabled="!selectedSetIsValid"
            @click="submitTradeCards"
          >
            Trade for +{{ nextTradeBonus }}
          </button>
          <div v-if="players.length > 1" class="cb-opponent-cards">
            <div v-for="p in players" :key="`cards-${p.userId}`" class="cb-opponent-card-row">
              <span class="cb-legend-swatch" :style="{ background: p.color ?? '#999' }" />
              {{ p.displayName }}
              <span class="text-muted">🃏 {{ cardCountFor(p.seatIndex) }}</span>
            </div>
          </div>
        </template>
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
  flex: 1 1 680px;
  min-width: 280px;
  max-width: 920px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.cb-map-wrap {
  position: relative;
}

.conquest-map {
  width: 100%;
  aspect-ratio: 1000 / 620;
  background: radial-gradient(ellipse at 50% 40%, #1c2b45, #0f1524);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: grab;
  /* Own the pointer instead of letting the browser use it for native
     page scroll/pinch-zoom while dragging/pinching on the map. */
  touch-action: none;
}

.cb-map-panning {
  cursor: grabbing;
}

.cb-zoom-controls {
  position: absolute;
  right: 0.6rem;
  bottom: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.cb-zoom-btn {
  width: 2.1rem;
  height: 2.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 26, 0.9);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  color: var(--color-text);
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.cb-zoom-btn:hover {
  border-color: rgba(255, 255, 255, 0.4);
}

.cb-watermark {
  position: absolute;
  left: 0.75rem;
  bottom: 2.9rem;
  font-weight: 800;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.32);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  user-select: none;
}

.cb-trophies-float {
  position: absolute;
  left: 0.6rem;
  bottom: 0.6rem;
  max-width: 17rem;
  max-height: 88%;
  display: flex;
  flex-direction: column;
  background: rgba(10, 14, 26, 0.85);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  backdrop-filter: blur(2px);
  font-size: 0.76rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition: background 0.15s ease;
}

.cb-trophies-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.4rem 0.65rem;
  background: transparent;
  border: none;
  color: var(--color-text);
  font-weight: 700;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}

.cb-trophies-toggle:hover {
  color: #ffd93d;
}

.cb-trophies-chevron {
  color: var(--color-text-muted);
}

.cb-trophies-body {
  padding: 0 0.7rem 0.6rem;
  overflow-y: auto;
  width: 17rem;
  max-width: 100%;
}

.cb-landmass {
  fill-opacity: 0.85;
  stroke: rgba(0, 0, 0, 0.45);
  stroke-width: 0.75;
}

.cb-territory-boundary {
  fill-opacity: 0.4;
  stroke: rgba(10, 10, 20, 0.55);
  stroke-width: 0.6;
  stroke-linejoin: round;
  pointer-events: none;
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

.cb-edge-wrap-stub {
  opacity: 0.7;
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
  stroke: var(--rank-color, #999);
  stroke-width: 1.4;
}

.cb-node-rankbadge {
  fill: #1a2033;
  stroke: var(--rank-color, #999);
  stroke-width: 1;
}

.cb-rank-chevron {
  fill: none;
  stroke: var(--rank-color, #ccc);
  stroke-width: 0.7;
  stroke-linecap: round;
  stroke-linejoin: round;
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

.cb-continent-badge {
  pointer-events: none;
}

.cb-continent-badge rect {
  stroke: rgba(0, 0, 0, 0.5);
  stroke-width: 1;
  fill-opacity: 0.9;
}

.cb-continent-badge-text {
  font-size: 10px;
  font-weight: 800;
  fill: #fff;
  text-anchor: middle;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 1.5;
}

/* A continent fully owned by one seat gets a gold outline and a bigger,
   bolder badge so it stands out as "claimed" on the map. */
.cb-continent-badge-owned rect {
  stroke: #ffd54a;
  stroke-width: 2;
}

.cb-continent-badge-owned .cb-continent-badge-text {
  font-size: 12px;
  font-weight: 900;
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
  flex: 0 0 290px;
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

.cb-panel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.cb-panel-toggle-title {
  margin: 0;
}

.cb-panel-toggle-chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  margin-bottom: 0.5rem;
}

.cb-panel-toggle:hover .cb-panel-toggle-title,
.cb-panel-toggle:hover .cb-panel-toggle-chevron {
  color: #ffd93d;
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

.cb-player-continents {
  margin: 0.25rem 0 0;
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.cb-player-territories-toggle {
  margin-top: 0.25rem;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.68rem;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cb-player-territories-toggle:hover {
  color: var(--color-text);
}

.cb-player-territories-list {
  margin: 0.25rem 0 0;
  font-size: 0.68rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.cb-action {
  font-size: 0.85rem;
}

.cb-action p {
  margin: 0 0 0.4rem;
}

.cb-pass-btn {
  width: 100%;
  margin-top: 0.6rem;
}

.cb-end-turn-btn {
  width: 100%;
  margin-top: 0.6rem;
}

.cb-continue-attack-btn {
  width: 100%;
  margin-top: 0.5rem;
}

.cb-occupy-more {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.cb-occupy-more .row {
  gap: 0.5rem;
}

.cb-reset-btn {
  width: 100%;
  margin-top: 0.4rem;
}

.cb-move-count {
  width: 3.5rem;
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

.cb-bonus-note {
  font-size: 0.72rem;
}

.cb-trophies-subtitle {
  margin: 0.6rem 0 0.3rem;
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.cb-trophies-subtitle:first-of-type {
  margin-top: 0;
}

.cb-trophies-note {
  margin: 0.4rem 0 0;
  font-size: 0.68rem;
}

.cb-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.cb-table th:first-child,
.cb-table td:first-child {
  width: 46%;
}

.cb-table th {
  text-align: left;
  padding: 0.2rem 0.3rem;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}

.cb-table td {
  padding: 0.25rem 0.3rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.cb-table tbody tr:last-child td {
  border-bottom: none;
}

.cb-table-continent {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.cb-table-next td {
  background: rgba(255, 217, 61, 0.12);
  font-weight: 700;
}

.cb-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.cb-cards {
  font-size: 0.8rem;
}

.cb-must-trade {
  margin: 0 0 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius);
  background: rgba(255, 217, 61, 0.15);
  color: #ffd93d;
  font-size: 0.78rem;
}

.cb-hand {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.cb-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.35rem 0.4rem;
  border-radius: var(--radius);
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.62rem;
  /* Fixed (not just min-) width so long territory names wrap onto a
     second line instead of stretching the button wide -- without this,
     a narrow sidebar column (desktop) only fits one card per row. */
  width: 4.2rem;
  transition:
    border-color 0.1s ease,
    transform 0.1s ease;
}

.cb-card:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cb-card:not(:disabled):hover {
  border-color: rgba(255, 255, 255, 0.4);
}

.cb-card-selected {
  border-color: #ffd93d;
  transform: translateY(-2px);
}

.cb-card-icon {
  font-size: 1.1rem;
}

.cb-card-name {
  text-align: center;
  line-height: 1.1;
  white-space: normal;
  word-break: break-word;
}

.cb-trade-btn {
  width: 100%;
  margin-bottom: 0.5rem;
}

.cb-opponent-cards {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--color-border);
}

.cb-opponent-card-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
}

.cb-opponent-card-row .text-muted {
  margin-left: auto;
}

@media (max-width: 640px) {
  .cb-node-label {
    font-size: 6px;
  }

  .cb-trophies-float {
    max-height: 78%;
    font-size: 0.6rem;
  }

  .cb-trophies-body {
    width: 12rem;
    padding: 0 0.45rem 0.4rem;
  }

  .cb-trophies-toggle {
    padding: 0.35rem 0.45rem;
  }

  .cb-continent-badge-text {
    font-size: 8px;
  }

  .cb-continent-badge-owned .cb-continent-badge-text {
    font-size: 9.5px;
  }
}
</style>
