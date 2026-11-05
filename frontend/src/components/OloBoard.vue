<script setup lang="ts">
// OLO -- a shuffleboard-style disc-flicking duel (originally prototyped as
// "FLICK"). Unlike Ludo/Snakes & Ladders, this is real-time physics
// (Matter.js), not a discrete dice-and-move game, so it doesn't route
// through the generic room game-engine flow at all:
//   - mode="local": fully self-contained, no room/network involved --
//     pass-and-play on one device, or vs a simple bot. Both seats'
//     discs are generated and simulated right here.
//   - mode="online": embedded in a real room. The initial disc layout
//     comes from the server (OloEngine.createInitialState, so both
//     players start from the exact same discs). Whoever's turn it is
//     runs the physics locally and streams live positions + the final
//     settled result up to the parent (RoomView), which relays them
//     through the room's socket; the other player just renders whatever
//     arrives, no local physics for the opponent's shot.
import { onMounted, onUnmounted, ref, watch } from 'vue';
import Matter from 'matter-js';
import type { RoomPlayer } from '../types';

const { Engine, World, Bodies, Body, Composite, Events } = Matter;

// ---------------- Shared disc/board shape (matches backend OloEngine) ---
type OloDiscClass = 'light' | 'medium' | 'heavy';

interface OloDisc {
  id: string;
  owner: number; // seatIndex
  xFrac: number;
  yFrac: number;
  rFrac: number;
  density: number;
  frictionAir: number;
  restitution: number;
  cls: OloDiscClass;
  alive: boolean;
  usesLeft: number;
  resting: boolean;
}

interface OloBoardState {
  discs: OloDisc[];
  scores: Record<number, number>;
  topSeat: number;
  bottomSeat: number;
}

interface LivePositionsPayload {
  positions: Array<{ id: string; x: number; y: number }>;
}

interface ShotResultPayload {
  boardState: OloBoardState;
  nextTurnSeat: number;
  isGameOver: boolean;
  winnerSeat?: number;
}

const props = defineProps<{
  mode: 'online' | 'local';
  vsAi?: boolean;
  boardState?: OloBoardState | null;
  players?: RoomPlayer[];
  currentTurnSeat?: number | null;
  mySeatIndex?: number | null;
  liveOpponentPositions?: LivePositionsPayload | null;
}>();

const emit = defineEmits<{
  shotResult: [payload: ShotResultPayload];
  livePositions: [payload: LivePositionsPayload];
}>();

// ---------------- Local-mode disc generation (mirrors backend exactly) --
const DISC_R_MIN = 0.02;
const DISC_R_MAX = 0.068;
const DENSITY_MIN = 0.0006;
const DENSITY_MAX = 0.0034;
const DISCS_PER_PLAYER = 6;
const MAX_USES = 3;
const ZONE_FREE_H = 0.1;
const ZONE_DROP_H = 0.14;

function randomDiscSpec(t: number) {
  const jitter = () => (Math.random() * 2 - 1) * 0.06;
  const sizeT = Math.max(0, Math.min(1, t + jitter()));
  const massT = Math.max(0, Math.min(1, t + jitter()));
  const rFrac = DISC_R_MIN + sizeT * (DISC_R_MAX - DISC_R_MIN);
  const density = DENSITY_MIN + massT * (DENSITY_MAX - DENSITY_MIN);
  const frictionAir = 0.03 - massT * 0.018;
  const restitution = 0.48 - massT * 0.24;
  let cls: OloDiscClass = 'medium';
  if (massT < 0.28) cls = 'light';
  else if (massT > 0.72) cls = 'heavy';
  return { rFrac, density, frictionAir, restitution, cls };
}

function generateDiscSet() {
  const positions = [0, 1, 0.35, 0.45, 0.55, 0.65];
  const specs = positions.map((t) => randomDiscSpec(t));
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [specs[i], specs[j]] = [specs[j], specs[i]];
  }
  return specs;
}

function stageDiscs(seatIndex: number, zoneYFrac: number): OloDisc[] {
  const specs = generateDiscSet();
  const maxRFrac = Math.max(...specs.map((s) => s.rFrac));
  const minSpacing = maxRFrac * 2 + 0.006;
  const evenSpacing = 1 / (DISCS_PER_PLAYER + 1);
  const spacing = Math.max(minSpacing, evenSpacing);
  const totalW = spacing * (DISCS_PER_PLAYER - 1);
  const startX = 0.5 - totalW / 2;
  return specs.map((spec, i) => {
    const rawX = startX + spacing * i;
    const xFrac = Math.max(
      spec.rFrac + 0.002,
      Math.min(1 - spec.rFrac - 0.002, rawX),
    );
    return {
      id: `${seatIndex}-${i}`,
      owner: seatIndex,
      xFrac,
      yFrac: zoneYFrac,
      rFrac: spec.rFrac,
      density: spec.density,
      frictionAir: spec.frictionAir,
      restitution: spec.restitution,
      cls: spec.cls,
      alive: true,
      usesLeft: MAX_USES,
      resting: false,
    };
  });
}

function generateLocalBoardState(): OloBoardState {
  const discs = [...stageDiscs(0, ZONE_FREE_H / 2), ...stageDiscs(1, 1 - ZONE_FREE_H / 2)];
  return { discs, scores: { 0: 0, 1: 0 }, topSeat: 0, bottomSeat: 1 };
}

// ---------------- Component state -----------------------------------
type Screen = 'title' | 'game' | 'gameover';
const screen = ref<Screen>(props.mode === 'online' ? 'game' : 'title');
const localVsAi = ref(false);

const containerEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

const turnLabel = ref('');
const toastMsg = ref('');
const toastVisible = ref(false);
const winnerLabel = ref('');
const scoresDisplay = ref<Record<number, number>>({ 0: 0, 1: 0 });
const currentSeatDisplay = ref(0);

let ctx: CanvasRenderingContext2D | null = null;
let engine: Matter.Engine | null = null;
let world: Matter.World | null = null;
let wallBodies: Matter.Body[] = [];
let boardW = 380;
let boardH = 640;
let dpr = 1;

interface DiscEntry {
  id: string;
  body: Matter.Body;
  r: number;
  owner: number;
  cls: OloDiscClass;
  alive: boolean;
  used: boolean;
  resting: boolean;
  usesLeft: number;
}
let discEntries: DiscEntry[] = [];
let topSeat = 0;
let bottomSeat = 1;
let currentSeat = 0;
let gameOver = false;
let animating = false;
let mediumMassRef = 1;
let resizeObserver: ResizeObserver | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let rafHandle: number | undefined;
let lastLiveEmitAt = 0;
const LIVE_EMIT_INTERVAL_MS = 70;

function playerColor(seatIndex: number): string {
  const fromRoom = props.players?.find((p) => p.seatIndex === seatIndex)?.color;
  if (fromRoom) return fromRoom;
  return seatIndex === topSeat ? '#e0562a' : '#4a5fc1';
}

function playerName(seatIndex: number): string {
  return (
    props.players?.find((p) => p.seatIndex === seatIndex)?.displayName ??
    `Seat ${seatIndex}`
  );
}

function isMyTurnToShoot(): boolean {
  if (gameOver) return false;
  if (props.mode === 'online') {
    return (
      props.mySeatIndex != null &&
      props.mySeatIndex === currentSeat &&
      currentSeat === (props.currentTurnSeat ?? currentSeat)
    );
  }
  // local mode: both seats are shootable on this device, unless it's the
  // bot's seat (bottomSeat is always the bot when vsAi is on).
  if (localVsAi.value && currentSeat === bottomSeat) return false;
  return true;
}

function zoneRects() {
  const w = boardW;
  const h = boardH;
  const topFree = { x: 0, y: 0, w, h: h * ZONE_FREE_H };
  const bottomDrop = {
    x: 0,
    y: h * (1 - ZONE_DROP_H - ZONE_FREE_H),
    w,
    h: h * ZONE_DROP_H,
  };
  const topDrop = { x: 0, y: h * ZONE_FREE_H, w, h: h * ZONE_DROP_H };
  const bottomFree = { x: 0, y: h * (1 - ZONE_FREE_H), w, h: h * ZONE_FREE_H };
  // top seat's drop zone is near the BOTTOM (far end), and vice versa --
  // scoring means sliding almost the whole length of the table.
  return {
    topFree,
    bottomFree,
    topSeatDrop: bottomDrop,
    bottomSeatDrop: topDrop,
  };
}

function showToast(msg: string) {
  toastMsg.value = msg;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastVisible.value = false), 1400);
}

// ---------------- Engine lifecycle -----------------------------------
function teardownEngine() {
  if (engine) {
    Events.off(engine, undefined as never, undefined as never);
    if (world) World.clear(world, false);
    Engine.clear(engine);
  }
  engine = null;
  world = null;
  discEntries = [];
  wallBodies = [];
}

function buildWalls() {
  if (!world) return;
  wallBodies.forEach((w) => Composite.remove(world!, w));
  wallBodies = [];
  const w = boardW;
  const h = boardH;
  const t = 40;
  const left = Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, {
    isStatic: true,
    restitution: 0.55,
    friction: 0.05,
    label: 'wall',
  });
  const right = Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, {
    isStatic: true,
    restitution: 0.55,
    friction: 0.05,
    label: 'wall',
  });
  const top = Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, {
    isStatic: true,
    restitution: 0.55,
    friction: 0.05,
    label: 'wall',
  });
  const bottom = Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, {
    isStatic: true,
    restitution: 0.55,
    friction: 0.05,
    label: 'wall',
  });
  wallBodies = [left, right, top, bottom];
  Composite.add(world, wallBodies);
}

function loadDiscs(state: OloBoardState) {
  if (!world) return;
  discEntries.forEach((d) => Composite.remove(world!, d.body));
  discEntries = [];
  topSeat = state.topSeat;
  bottomSeat = state.bottomSeat;
  scoresDisplay.value = { ...state.scores };

  for (const disc of state.discs) {
    if (!disc.alive) continue;
    const r = boardW * disc.rFrac;
    const body = Bodies.circle(disc.xFrac * boardW, disc.yFrac * boardH, r, {
      density: disc.density,
      frictionAir: disc.frictionAir,
      restitution: disc.restitution,
      friction: 0.01,
      label: 'disc',
    });
    Composite.add(world, body);
    discEntries.push({
      id: disc.id,
      body,
      r,
      owner: disc.owner,
      cls: disc.cls,
      alive: true,
      used: false,
      resting: disc.resting,
      usesLeft: disc.usesLeft,
    });
  }

  const refR = boardW * (DISC_R_MIN + DISC_R_MAX) / 2;
  const refDensity = (DENSITY_MIN + DENSITY_MAX) / 2;
  mediumMassRef = Math.PI * refR * refR * refDensity;
}

function serializeState(): OloBoardState {
  const scores: Record<number, number> = { [topSeat]: 0, [bottomSeat]: 0 };
  const zr = zoneRects();
  for (const d of discEntries) {
    if (!d.alive || !d.resting) continue;
    const p = d.body.position;
    const dropRect = d.owner === topSeat ? zr.topSeatDrop : zr.bottomSeatDrop;
    if (pointInRect(p.x, p.y, dropRect)) scores[d.owner] = (scores[d.owner] ?? 0) + 1;
  }
  scoresDisplay.value = scores;
  return {
    discs: discEntries.map((d) => ({
      id: d.id,
      owner: d.owner,
      xFrac: d.body.position.x / boardW,
      yFrac: d.body.position.y / boardH,
      rFrac: d.r / boardW,
      density: d.body.density,
      frictionAir: d.body.frictionAir,
      restitution: d.body.restitution,
      cls: d.cls,
      alive: d.alive,
      usesLeft: d.usesLeft,
      resting: d.resting,
    })),
    scores,
    topSeat,
    bottomSeat,
  };
}

function pointInRect(
  px: number,
  py: number,
  rect: { x: number; y: number; w: number; h: number },
) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

function setupEngine(initial: OloBoardState) {
  teardownEngine();
  engine = Engine.create();
  world = engine.world;
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  buildWalls();
  loadDiscs(initial);
}

function startLocalMatch(vsAi: boolean) {
  localVsAi.value = vsAi;
  gameOver = false;
  currentSeat = topSeat;
  screen.value = 'game';
  const state = generateLocalBoardState();
  setupEngine(state);
  currentSeat = state.topSeat;
  updateTurnLabel();
}

function updateTurnLabel() {
  const seat = props.mode === 'online' ? props.currentTurnSeat ?? currentSeat : currentSeat;
  currentSeatDisplay.value = seat;
  const isBot = props.mode === 'local' && localVsAi.value && seat === bottomSeat;
  turnLabel.value = isBot ? `${playerName(seat)} (bot)'s turn` : `${playerName(seat)}'s turn`;
}

// ---------------- Settling / scoring (ported from the original) -------
function isMoving(): boolean {
  return discEntries.some((d) => d.alive && Matter.Body.getSpeed(d.body) > 0.06);
}

function stepEngine(delta: number) {
  if (engine) Engine.update(engine, delta);
}

function returnDiscToFreeZone(d: DiscEntry) {
  const homeY = d.owner === topSeat ? boardH * (ZONE_FREE_H / 2) : boardH * (1 - ZONE_FREE_H / 2);
  const x = Math.max(d.r + 2, Math.min(boardW - d.r - 2, d.body.position.x));
  Body.setVelocity(d.body, { x: 0, y: 0 });
  Body.setAngularVelocity(d.body, 0);
  Body.setPosition(d.body, { x, y: homeY });
  d.resting = false;
}

function settleScoring() {
  const zr = zoneRects();

  const justShot = discEntries.filter((d) => d.alive && d.used);
  for (const d of justShot) {
    const p = d.body.position;
    const inOwnDrop = pointInRect(
      p.x,
      p.y,
      d.owner === topSeat ? zr.topSeatDrop : zr.bottomSeatDrop,
    );
    const inEnemyFree = pointInRect(
      p.x,
      p.y,
      d.owner === topSeat ? zr.bottomFree : zr.topFree,
    );
    d.used = false;

    if (inEnemyFree) {
      d.usesLeft -= 1;
      if (d.usesLeft <= 0) {
        d.alive = false;
        if (world) Composite.remove(world, d.body);
        showToast(`${playerName(d.owner)} disc worn out`);
      } else {
        returnDiscToFreeZone(d);
        showToast(`${playerName(d.owner)} disc sent home`);
      }
    } else if (inOwnDrop) {
      d.resting = true;
      showToast(`${playerName(d.owner)} scores!`);
    } else {
      d.resting = true;
    }
  }

  const bumpedOut = discEntries.filter((d) => d.alive && d.resting && !d.used);
  for (const d of bumpedOut) {
    const p = d.body.position;
    const inEnemyFree = pointInRect(
      p.x,
      p.y,
      d.owner === topSeat ? zr.bottomFree : zr.topFree,
    );
    if (inEnemyFree) {
      d.resting = false;
      d.usesLeft -= 1;
      if (d.usesLeft <= 0) {
        d.alive = false;
        if (world) Composite.remove(world, d.body);
        showToast(`${playerName(d.owner)} disc worn out`);
      } else {
        returnDiscToFreeZone(d);
        showToast(`${playerName(d.owner)} disc knocked home!`);
      }
    }
  }

  const topLeft = discEntries.some((d) => d.owner === topSeat && d.alive);
  const bottomLeft = discEntries.some((d) => d.owner === bottomSeat && d.alive);

  const state = serializeState();
  let isGameOver = false;
  let winnerSeat: number | undefined;
  if (!topLeft || !bottomLeft) {
    isGameOver = true;
    winnerSeat = !topLeft ? bottomSeat : topSeat;
    gameOver = true;
    winnerLabel.value = `${playerName(winnerSeat)} wins`;
    screen.value = 'gameover';
  }

  const nextSeat = currentSeat === topSeat ? bottomSeat : topSeat;

  if (props.mode === 'online') {
    emit('shotResult', { boardState: state, nextTurnSeat: nextSeat, isGameOver, winnerSeat });
    // Local currentSeat is kept in sync via the currentTurnSeat prop watcher.
  } else {
    currentSeat = nextSeat;
    updateTurnLabel();
    if (localVsAi.value && !isGameOver && currentSeat === bottomSeat) {
      setTimeout(aiTakeShot, 700);
    }
  }
}

// ---------------- AI (local vs-bot mode only) -------------------------
function aiTakeShot() {
  if (gameOver) return;
  const list = discEntries.filter(
    (d) => d.owner === bottomSeat && d.alive && !d.used && !d.resting,
  );
  if (list.length === 0) return;
  const d = list[0];
  const zr = zoneRects();
  const target = zr.bottomSeatDrop;
  const targetX = target.x + target.w * (0.3 + Math.random() * 0.4);
  const targetY = target.y + target.h * (0.35 + Math.random() * 0.3);
  const p = d.body.position;
  const dx = targetX - p.x;
  const dy = targetY - p.y;
  const dist = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const speed = Math.min(dist * 0.012 + Math.random() * 0.3, 3.2);
  const vx = Math.cos(ang) * speed;
  const vy = Math.sin(ang) * speed;
  const massFactor = mediumMassRef / d.body.mass;
  Body.setVelocity(d.body, { x: vx * 16.6 * massFactor, y: vy * 16.6 * massFactor });
  d.used = true;
  animating = true;
}

// ---------------- Canvas sizing ---------------------------------------
function resizeCanvas() {
  const container = containerEl.value;
  const canvas = canvasEl.value;
  if (!container || !canvas || !ctx) return;
  const availW = container.clientWidth - 16;
  const availH = container.clientHeight - 16;
  let w = availW;
  let h = w / 0.58;
  if (h > availH) {
    h = availH;
    w = h * 0.58;
  }
  const newW = Math.max(260, w);
  const newH = Math.max(440, h);
  if (Math.abs(newW - boardW) < 1 && Math.abs(newH - boardH) < 1 && canvas.width > 0) return;

  const prevW = boardW;
  const prevH = boardH;
  boardW = newW;
  boardH = newH;
  dpr = window.devicePixelRatio || 1;
  canvas.width = boardW * dpr;
  canvas.height = boardH * dpr;
  canvas.style.width = `${boardW}px`;
  canvas.style.height = `${boardH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (engine && world) {
    const sx = boardW / prevW;
    const sy = boardH / prevH;
    discEntries.forEach((d) => {
      if (!d.alive) return;
      const oldPos = d.body.position;
      const newX = oldPos.x * sx;
      const newY = oldPos.y * sy;
      const newR = d.r * sx;
      Composite.remove(world!, d.body);
      const newBody = Bodies.circle(newX, newY, newR, {
        density: d.body.density,
        frictionAir: d.body.frictionAir,
        restitution: d.body.restitution,
        friction: d.body.friction,
        label: 'disc',
      });
      Composite.add(world!, newBody);
      d.body = newBody;
      d.r = newR;
    });
    buildWalls();
  }
}

// ---------------- Rendering --------------------------------------------
// Visual-only state: short motion trails per disc, so fast shots leave a
// streak behind them. Never feeds back into physics or the network.
const TRAIL_LEN = 10;
const trails = new Map<string, Array<{ x: number; y: number }>>();

function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  let rgb: number[] | null = null;
  if (m6) rgb = [m6[1], m6[2], m6[3]].map((h) => parseInt(h, 16));
  else if (m3) rgb = [m3[1], m3[2], m3[3]].map((h) => parseInt(h + h, 16));
  if (!rgb) return color; // named colours: caller also sets globalAlpha
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function shade(color: string, amount: number): string {
  // amount > 0 lightens toward white, < 0 darkens toward black.
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m6) return color;
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  const ch = [m6[1], m6[2], m6[3]].map((h) => {
    const v = parseInt(h, 16);
    return Math.round(v + (target - v) * t);
  });
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function draw() {
  if (!ctx) return;
  const c = ctx;
  const w = boardW;
  const h = boardH;
  const t = performance.now() / 1000;
  c.clearRect(0, 0, w, h);

  // Ice sheet: cool navy with a spotlight in the middle.
  const base = c.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#0d1b2e');
  base.addColorStop(0.5, '#132a45');
  base.addColorStop(1, '#0d1b2e');
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  const spot = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.6);
  spot.addColorStop(0, 'rgba(125, 211, 252, 0.16)');
  spot.addColorStop(1, 'rgba(125, 211, 252, 0)');
  c.fillStyle = spot;
  c.fillRect(0, 0, w, h);

  // Faint skate-scratch lines for texture.
  c.save();
  c.strokeStyle = 'rgba(186, 230, 253, 0.035)';
  c.lineWidth = 1;
  for (let i = -h; i < w + h; i += 22) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i + h * 0.35, h);
    c.stroke();
  }
  c.restore();

  const zr = zoneRects();
  drawZone(zr.topFree, playerColor(topSeat), 'LAUNCH', false, true);
  drawZone(zr.topSeatDrop, playerColor(topSeat), 'SCORE', true, false);
  drawZone(zr.bottomSeatDrop, playerColor(bottomSeat), 'SCORE', true, true);
  drawZone(zr.bottomFree, playerColor(bottomSeat), 'LAUNCH', false, false);

  // Centre line + face-off circle.
  c.save();
  c.shadowColor = 'rgba(56, 189, 248, 0.8)';
  c.shadowBlur = 8;
  c.strokeStyle = 'rgba(125, 211, 252, 0.45)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, h / 2);
  c.lineTo(w, h / 2);
  c.stroke();
  c.beginPath();
  c.arc(w / 2, h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = 'rgba(125, 211, 252, 0.6)';
  c.beginPath();
  c.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // Rink boards.
  c.save();
  c.strokeStyle = 'rgba(226, 240, 255, 0.55)';
  c.lineWidth = 3;
  c.shadowColor = 'rgba(56, 189, 248, 0.6)';
  c.shadowBlur = 10;
  c.strokeRect(1.5, 1.5, w - 3, h - 3);
  c.restore();

  const shootable = isMyTurnToShoot();

  // Motion trails.
  discEntries.forEach((d) => {
    if (!d.alive) {
      trails.delete(d.id);
      return;
    }
    const p = d.body.position;
    const speed = Math.hypot(d.body.velocity.x, d.body.velocity.y);
    const trail = trails.get(d.id) ?? [];
    if (speed > 1.2) {
      trail.push({ x: p.x, y: p.y });
      if (trail.length > TRAIL_LEN) trail.shift();
    } else if (trail.length) {
      trail.shift();
    }
    trails.set(d.id, trail);
    if (trail.length < 2) return;
    const color = playerColor(d.owner);
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      c.beginPath();
      c.moveTo(trail[i - 1].x, trail[i - 1].y);
      c.lineTo(trail[i].x, trail[i].y);
      c.strokeStyle = withAlpha(color, a * 0.45);
      c.lineWidth = d.r * 1.4 * a;
      c.lineCap = 'round';
      c.stroke();
    }
  });

  discEntries.forEach((d) => {
    if (!d.alive) return;
    const p = d.body.position;
    const r = d.r;
    const color = playerColor(d.owner);
    const isActive = d.owner === currentSeat && !d.used && !d.resting && !animating && shootable;

    // Ground shadow.
    c.beginPath();
    c.ellipse(p.x + r * 0.12, p.y + r * 0.28, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0, 0, 0, 0.45)';
    c.fill();

    // Halo: pulsing for discs you can flick right now, gold for scored.
    if (isActive || d.resting) {
      const pulse = isActive ? 0.5 + 0.5 * Math.sin(t * 5) : 1;
      c.save();
      c.shadowColor = d.resting ? '#facc15' : color;
      c.shadowBlur = 18 + pulse * 10;
      c.beginPath();
      c.arc(p.x, p.y, r + 3 + pulse * 2, 0, Math.PI * 2);
      c.strokeStyle = d.resting ? 'rgba(250, 204, 21, 0.9)' : 'rgba(255, 255, 255, 0.85)';
      c.lineWidth = 2;
      c.stroke();
      c.restore();
    }

    // Puck body: lit from the top-left.
    const body = c.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    body.addColorStop(0, shade(color, 0.45));
    body.addColorStop(0.55, color);
    body.addColorStop(1, shade(color, -0.45));
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fillStyle = body;
    c.fill();

    // Rim: thicker for heavier discs, so weight reads at a glance.
    c.lineWidth = d.cls === 'heavy' ? 4 : d.cls === 'medium' ? 2.5 : 1.5;
    c.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    c.stroke();

    // Inner groove ring.
    c.beginPath();
    c.arc(p.x, p.y, r * 0.66, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    c.lineWidth = Math.max(1, r * 0.06);
    c.stroke();

    // Specular highlight.
    c.beginPath();
    c.ellipse(p.x - r * 0.32, p.y - r * 0.38, r * 0.34, r * 0.2, -0.6, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255, 255, 255, 0.35)';
    c.fill();

    // Remaining-uses pips.
    const pipR = Math.max(1.5, r * 0.09);
    const pipGap = pipR * 2.6;
    const totalW = pipGap * (MAX_USES - 1);
    for (let i = 0; i < MAX_USES; i++) {
      c.beginPath();
      c.arc(p.x - totalW / 2 + i * pipGap, p.y + r * 0.62, pipR, 0, Math.PI * 2);
      c.fillStyle = i < d.usesLeft ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.5)';
      c.fill();
    }
  });
}

function drawZone(
  rect: { x: number; y: number; w: number; h: number },
  color: string,
  label: string,
  isDrop: boolean,
  fadeDown: boolean,
) {
  if (!ctx) return;
  const c = ctx;
  c.save();
  // Glowing band that fades toward the middle of the rink.
  const g = c.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  const strong = withAlpha(color, isDrop ? 0.38 : 0.22);
  const weak = withAlpha(color, isDrop ? 0.08 : 0.04);
  g.addColorStop(0, fadeDown ? strong : weak);
  g.addColorStop(1, fadeDown ? weak : strong);
  if (!color.startsWith('#')) c.globalAlpha = isDrop ? 0.3 : 0.18;
  c.fillStyle = g;
  c.fillRect(rect.x, rect.y, rect.w, rect.h);
  c.globalAlpha = 1;

  // Neon edge lines.
  c.shadowColor = color;
  c.shadowBlur = isDrop ? 12 : 6;
  c.strokeStyle = withAlpha(color, isDrop ? 0.9 : 0.5);
  c.lineWidth = isDrop ? 2.5 : 1.5;
  c.setLineDash(isDrop ? [] : [6, 6]);
  c.beginPath();
  c.moveTo(rect.x, rect.y + 1);
  c.lineTo(rect.x + rect.w, rect.y + 1);
  c.moveTo(rect.x, rect.y + rect.h - 1);
  c.lineTo(rect.x + rect.w, rect.y + rect.h - 1);
  c.stroke();
  c.setLineDash([]);
  c.shadowBlur = 0;

  // Chevrons pointing down-table for launch pads; big label for scoring.
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (isDrop) {
    c.font = `800 ${Math.max(11, rect.h * 0.22)}px 'Exo 2', system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = withAlpha(color, 0.55);
    if (!color.startsWith('#')) c.globalAlpha = 0.55;
    const spaced = label.split('').join(' ');
    c.fillText(`★ ${spaced} ★`, cx, cy);
    c.globalAlpha = 1;
  } else {
    c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    c.lineWidth = 2;
    const dir = fadeDown ? 1 : -1;
    for (const x of [rect.w * 0.12, rect.w * 0.88]) {
      for (let k = 0; k < 2; k++) {
        const yy = cy + dir * (k * 6 - 3);
        c.beginPath();
        c.moveTo(x - 6, yy - dir * 4);
        c.lineTo(x, yy + dir * 2);
        c.lineTo(x + 6, yy - dir * 4);
        c.stroke();
      }
    }
  }
  c.restore();
}

// ---------------- Input: drag / swipe -----------------------------------
let dragging = false;
let dragEntry: DiscEntry | null = null;
let dragOffset = { x: 0, y: 0 };
let posHistory: Array<{ x: number; y: number; t: number }> = [];

function getPointer(evt: MouseEvent | TouchEvent) {
  const canvas = canvasEl.value!;
  const rect = canvas.getBoundingClientRect();
  const t: { clientX: number; clientY: number } =
    'touches' in evt && evt.touches[0]
      ? evt.touches[0]
      : 'changedTouches' in evt && evt.changedTouches[0]
        ? evt.changedTouches[0]
        : (evt as MouseEvent);
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

function findMyDiscAt(pt: { x: number; y: number }): DiscEntry | null {
  const list = discEntries.filter(
    (d) => d.owner === currentSeat && d.alive && !d.used && !d.resting,
  );
  let closest: DiscEntry | null = null;
  let closestDist = 9999;
  for (const d of list) {
    const p = d.body.position;
    const dist = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (dist < d.r * 1.8 && dist < closestDist) {
      closest = d;
      closestDist = dist;
    }
  }
  return closest;
}

function onDown(evt: MouseEvent | TouchEvent) {
  if (animating || gameOver || !engine || dragging) return;
  if (!isMyTurnToShoot()) return;
  evt.preventDefault();
  const pt = getPointer(evt);
  const entry = findMyDiscAt(pt);
  if (!entry) return;
  dragging = true;
  dragEntry = entry;
  Body.setStatic(entry.body, false);
  dragOffset = { x: pt.x - entry.body.position.x, y: pt.y - entry.body.position.y };
  posHistory = [{ x: pt.x, y: pt.y, t: performance.now() }];
}

function onMove(evt: MouseEvent | TouchEvent) {
  if (!dragging || !dragEntry) return;
  evt.preventDefault();
  const pt = getPointer(evt);
  const d = dragEntry;
  const now = performance.now();
  const dt = Math.max(1, now - (posHistory[posHistory.length - 1]?.t ?? now));
  const targetX = Math.max(d.r, Math.min(boardW - d.r, pt.x - dragOffset.x));
  const targetY = Math.max(d.r, Math.min(boardH - d.r, pt.y - dragOffset.y));
  const vx = ((targetX - d.body.position.x) / dt) * 16.6;
  const vy = ((targetY - d.body.position.y) / dt) * 16.6;
  Body.setVelocity(d.body, { x: vx, y: vy });
  Body.setPosition(d.body, { x: targetX, y: targetY });
  posHistory.push({ x: pt.x, y: pt.y, t: now });
  posHistory = posHistory.filter((p) => now - p.t < 100);
}

function snapDiscBack(d: DiscEntry) {
  const homeY = d.owner === topSeat ? boardH * (ZONE_FREE_H / 2) : boardH * (1 - ZONE_FREE_H / 2);
  Body.setVelocity(d.body, { x: 0, y: 0 });
  Body.setPosition(d.body, {
    x: Math.max(d.r, Math.min(boardW - d.r, d.body.position.x)),
    y: homeY,
  });
}

function onUp() {
  if (!dragging || !dragEntry) return;
  dragging = false;
  const d = dragEntry;
  dragEntry = null;
  const now = performance.now();
  const recent = posHistory.filter((p) => now - p.t < 90);

  let vx = 0;
  let vy = 0;
  if (recent.length >= 2) {
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = Math.max(1, last.t - first.t);
    let rawVx = (last.x - first.x) / dt;
    let rawVy = (last.y - first.y) / dt;
    const speed = Math.hypot(rawVx, rawVy);
    const maxSpeed = 3.2;
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      rawVx *= s;
      rawVy *= s;
    }
    vx = rawVx;
    vy = rawVy;
  }
  posHistory = [];

  const speed = Math.hypot(vx, vy);
  if (speed < 0.12) {
    snapDiscBack(d);
    return;
  }

  const massFactor = mediumMassRef / d.body.mass;
  Body.setVelocity(d.body, { x: vx * 16.6 * massFactor, y: vy * 16.6 * massFactor });
  d.used = true;
  animating = true;
}

// ---------------- Online spectating: render the opponent's relay ------
watch(
  () => props.liveOpponentPositions,
  (payload) => {
    if (!payload || props.mode !== 'online') return;
    for (const pos of payload.positions) {
      const entry = discEntries.find((d) => d.id === pos.id);
      if (entry) Body.setPosition(entry.body, { x: pos.x, y: pos.y });
    }
  },
);

// When a fresh authoritative boardState arrives (a shot just settled,
// mine or the opponent's), resync everything to it exactly.
watch(
  () => props.boardState,
  (state) => {
    if (!state || props.mode !== 'online') return;
    if (!engine) {
      setupEngine(state);
    } else {
      loadDiscs(state);
    }
    gameOver = false;
    updateTurnLabel();
  },
);

watch(
  () => props.currentTurnSeat,
  (seat) => {
    if (props.mode !== 'online' || seat == null) return;
    currentSeat = seat;
    updateTurnLabel();
  },
);

// ---------------- Main loop ---------------------------------------------
let lastTime = performance.now();
function loop(now: number) {
  const delta = Math.min(33, now - lastTime || 16.6);
  lastTime = now;

  if (engine) {
    const iAmShooting = props.mode !== 'online' || isMyTurnToShoot();
    if (animating && iAmShooting) {
      stepEngine(delta);
      if (!isMoving()) {
        animating = false;
        settleScoring();
      } else if (
        props.mode === 'online' &&
        now - lastLiveEmitAt > LIVE_EMIT_INTERVAL_MS
      ) {
        lastLiveEmitAt = now;
        emit('livePositions', {
          positions: discEntries
            .filter((d) => d.alive)
            .map((d) => ({ id: d.id, x: d.body.position.x, y: d.body.position.y })),
        });
      }
    } else if (dragging && iAmShooting) {
      stepEngine(delta);
    }
  }
  draw();
  rafHandle = requestAnimationFrame(loop);
}

// ---------------- Lifecycle ---------------------------------------------
onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp, { passive: false });

  resizeObserver = new ResizeObserver(() => resizeCanvas());
  if (containerEl.value) resizeObserver.observe(containerEl.value);
  resizeCanvas();

  if (props.mode === 'online' && props.boardState) {
    setupEngine(props.boardState);
    currentSeat = props.currentTurnSeat ?? props.boardState.topSeat;
    updateTurnLabel();
  }

  rafHandle = requestAnimationFrame(loop);
});

onUnmounted(() => {
  if (rafHandle) cancelAnimationFrame(rafHandle);
  resizeObserver?.disconnect();
  clearTimeout(toastTimer);
  teardownEngine();
});

function handleStartLocal(vsAi: boolean) {
  startLocalMatch(vsAi);
}

function handleRematch() {
  screen.value = 'title';
}

function handleMenu() {
  screen.value = 'title';
  teardownEngine();
}
</script>

<template>
  <div class="olo-wrapper">
    <!-- Local mode: title / setup screen (pass & play or vs bot) -->
    <div v-if="mode === 'local' && screen === 'title'" class="olo-title">
      <div class="olo-wordmark">OL<span>O</span></div>
      <p class="olo-tagline">a shuffleboard-style disc duel</p>
      <div class="olo-setup">
        <button class="btn btn-secondary" @click="handleStartLocal(false)">
          Pass &amp; play
        </button>
        <button class="btn btn-secondary" @click="handleStartLocal(true)">
          vs Bot
        </button>
      </div>
      <p class="olo-hint">
        Drag a disc from your free zone and flick it toward the far end.
        Land it in your drop zone to score; knock it into the enemy's free
        zone and it's sent home. Discs wear out after 3 uses. Big discs hit
        hard but move slow.
      </p>
    </div>

    <!-- Game screen -->
    <div v-else-if="mode === 'online' || screen === 'game'" class="olo-game">
      <div class="olo-hud">
        <span class="olo-turn">{{ turnLabel }}</span>
        <div class="olo-scores">
          <span
            v-for="seat in [topSeat, bottomSeat]"
            :key="seat"
            class="olo-score-chip"
            :class="{ current: seat === currentSeatDisplay }"
          >
            <span class="olo-dot" :style="{ background: playerColor(seat) }" />
            {{ scoresDisplay[seat] ?? 0 }}
          </span>
        </div>
        <button v-if="mode === 'local'" class="btn btn-secondary" @click="handleMenu">
          Menu
        </button>
      </div>

      <div ref="containerEl" class="olo-board-wrap">
        <canvas ref="canvasEl" class="olo-canvas" />
        <div class="olo-toast" :class="{ show: toastVisible }">{{ toastMsg }}</div>
      </div>
    </div>

    <!-- Game over (local mode only -- online game-over is handled by RoomView) -->
    <div v-if="mode === 'local' && screen === 'gameover'" class="olo-win-overlay">
      <div class="olo-win-text">{{ winnerLabel }}</div>
      <button class="btn btn-primary" @click="handleRematch">Rematch</button>
    </div>
  </div>
</template>

<style scoped>
.olo-wrapper {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  position: relative;
}

.olo-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  padding: 2rem 1rem;
  text-align: center;
}

.olo-wordmark {
  font-weight: 900;
  font-size: clamp(56px, 14vw, 96px);
  letter-spacing: 0.04em;
  line-height: 0.9;
  color: #e0f2fe;
  text-shadow:
    0 0 18px rgba(56, 189, 248, 0.7),
    0 6px 0 #1e3a5f;
}

.olo-wordmark span {
  color: #fb923c;
  text-shadow:
    0 0 18px rgba(251, 146, 60, 0.7),
    0 6px 0 #7c2d12;
}

.olo-tagline {
  font-size: 0.75rem;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: -0.5rem 0 0;
}

.olo-setup {
  display: flex;
  gap: 0.75rem;
}

.olo-hint {
  max-width: 340px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.olo-game {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.olo-hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.25rem;
}

.olo-turn {
  font-weight: 800;
  font-size: 1.05rem;
  letter-spacing: 0.02em;
  color: var(--color-text);
  text-shadow: 0 0 14px rgba(56, 189, 248, 0.55);
}

.olo-scores {
  display: flex;
  gap: 0.5rem;
}

.olo-score-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.8rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: rgba(13, 27, 46, 0.7);
  font-size: 1.05rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  opacity: 0.65;
  transition: all 0.2s ease;
}

.olo-score-chip.current {
  opacity: 1;
  border-color: rgba(125, 211, 252, 0.7);
  color: var(--color-text);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);
}

.olo-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow:
    inset 0 -2px 2px rgba(0, 0, 0, 0.35),
    inset 0 1px 1px rgba(255, 255, 255, 0.5);
}

.olo-board-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 0.58;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  overflow: hidden;
  background: #0d1b2e;
  box-shadow:
    0 0 0 3px #1e3a5f,
    0 0 0 5px rgba(125, 211, 252, 0.25),
    0 0 40px rgba(56, 189, 248, 0.2),
    0 26px 50px -16px rgba(0, 0, 0, 0.7);
}

.olo-canvas {
  touch-action: none;
}

.olo-toast {
  position: absolute;
  top: 10px;
  font-weight: 800;
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.5);
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  font-size: 0.7rem;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 0.4rem 1rem;
  background: #ede7db;
  color: #14110f;
  border-radius: 20px;
  opacity: 0;
  transition: all 0.25s ease;
  pointer-events: none;
  white-space: nowrap;
}

.olo-toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.olo-win-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 40%, rgba(30, 58, 95, 0.95), rgba(8, 15, 28, 0.96));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1.25rem;
  border-radius: 12px;
  z-index: 20;
}

.olo-win-text {
  font-weight: 900;
  font-size: 2.2rem;
  color: #fde68a;
  text-shadow: 0 0 22px rgba(250, 204, 21, 0.6);
}
</style>
