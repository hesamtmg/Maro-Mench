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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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

// ---------------- Board tilt / seat orientation -------------------------
// A slight 3D tilt (perspective + rotateX) makes the felt read as a table
// viewed at an angle rather than a flat top-down rectangle. On top of
// that, the "topSeat" player in an online match gets an extra 180deg
// flip so BOTH players always experience shooting bottom-to-top from
// their own device -- the two seats otherwise render identically
// (topSeat always at the absolute top of the canvas), which meant one
// player had to flick downward. getPointer() below undoes this exact
// transform to recover true canvas coordinates for drag/flick input.
const TILT_DEG = 8;
const TILT_RAD = (TILT_DEG * Math.PI) / 180;
const PERSPECTIVE_PX = 1500;
const topSeatRef = ref(0);
const isFlipped = computed(
  () => props.mode === 'online' && props.mySeatIndex != null && props.mySeatIndex === topSeatRef.value,
);
const canvasTransform = computed(
  () =>
    `perspective(${PERSPECTIVE_PX}px) rotateX(${TILT_DEG}deg)${isFlipped.value ? ' rotateZ(180deg)' : ''}`,
);

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

// Lightens (positive amt) or darkens (negative amt) a "#rrggbb" color for
// the disc's radial-gradient sphere shading.
function shiftColor(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((num >> 16) & 0xff) + amt * 255);
  const g = clamp(((num >> 8) & 0xff) + amt * 255);
  const b = clamp((num & 0xff) + amt * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

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
  topSeatRef.value = state.topSeat;
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
function draw() {
  if (!ctx) return;
  const w = boardW;
  const h = boardH;
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1c1815');
  grad.addColorStop(0.5, '#181410');
  grad.addColorStop(1, '#1c1815');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const zr = zoneRects();
  drawZone(zr.topFree, playerColor(topSeat), 'FREE', false);
  drawZone(zr.topSeatDrop, playerColor(topSeat), 'DROP', true);
  drawZone(zr.bottomSeatDrop, playerColor(bottomSeat), 'DROP', true);
  drawZone(zr.bottomFree, playerColor(bottomSeat), 'FREE', false);

  ctx.strokeStyle = 'rgba(237,231,219,0.15)';
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(237,231,219,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  discEntries.forEach((d) => {
    if (!d.alive) return;
    const p = d.body.position;

    // Contact shadow, offset toward the near edge, to lift the disc off
    // the felt.
    ctx!.beginPath();
    ctx!.ellipse(p.x + d.r * 0.1, p.y + d.r * 0.2, d.r * 0.95, d.r * 0.82, 0, 0, Math.PI * 2);
    ctx!.fillStyle = 'rgba(0,0,0,0.32)';
    ctx!.fill();

    // Spherical shading: a radial gradient from a bright highlight
    // (upper-left, as if lit from overhead) down through the base color
    // to a darkened rim, so the disc reads as a puck rather than a flat
    // circle.
    const base = playerColor(d.owner);
    const sheen = ctx!.createRadialGradient(
      p.x - d.r * 0.35,
      p.y - d.r * 0.4,
      d.r * 0.05,
      p.x,
      p.y,
      d.r,
    );
    sheen.addColorStop(0, shiftColor(base, 0.55));
    sheen.addColorStop(0.55, base);
    sheen.addColorStop(1, shiftColor(base, -0.35));
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, d.r, 0, Math.PI * 2);
    ctx!.fillStyle = sheen;
    ctx!.fill();

    const shootable = isMyTurnToShoot();
    const isActive = d.owner === currentSeat && !d.used && !d.resting && !animating && shootable;
    ctx!.lineWidth = d.cls === 'heavy' ? 4 : d.cls === 'medium' ? 2.5 : 1.5;
    ctx!.strokeStyle = d.resting ? '#f2d675' : isActive ? '#ede7db' : 'rgba(0,0,0,0.4)';
    ctx!.stroke();

    ctx!.beginPath();
    ctx!.arc(p.x - d.r * 0.32, p.y - d.r * 0.36, d.r * 0.26, 0, Math.PI * 2);
    ctx!.fillStyle = 'rgba(255,255,255,0.5)';
    ctx!.fill();

    const pipR = Math.max(1.5, d.r * 0.09);
    const pipGap = pipR * 2.6;
    const totalW = pipGap * (MAX_USES - 1);
    for (let i = 0; i < MAX_USES; i++) {
      ctx!.beginPath();
      ctx!.arc(p.x - totalW / 2 + i * pipGap, p.y + d.r * 0.62, pipR, 0, Math.PI * 2);
      ctx!.fillStyle = i < d.usesLeft ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.45)';
      ctx!.fill();
    }
  });
}

function drawZone(
  rect: { x: number; y: number; w: number; h: number },
  color: string,
  label: string,
  isDrop: boolean,
) {
  if (!ctx) return;
  ctx.fillStyle = color + (isDrop ? '1c' : '10');
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = color + '55';
  ctx.lineWidth = 1.5;
  ctx.setLineDash(isDrop ? [] : [3, 5]);
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  ctx.setLineDash([]);
  ctx.font = '10px monospace';
  ctx.fillStyle = color + '99';
  ctx.textAlign = 'center';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 3);
}

// ---------------- Input: drag / swipe -----------------------------------
let dragging = false;
let dragEntry: DiscEntry | null = null;
let dragOffset = { x: 0, y: 0 };
let posHistory: Array<{ x: number; y: number; t: number }> = [];

function getPointer(evt: MouseEvent | TouchEvent) {
  // Use the (untransformed) wrapper's box for the screen-space center --
  // the canvas itself is visually tilted/flipped via canvasTransform, so
  // its own getBoundingClientRect() no longer describes a plain axis-
  // aligned rectangle we could subtract from directly. The wrapper stays
  // untransformed and centers the canvas via flexbox, so its center
  // point is exactly the canvas's (fixed) transform-origin.
  const container = containerEl.value!;
  const rect = container.getBoundingClientRect();
  const t: { clientX: number; clientY: number } =
    'touches' in evt && evt.touches[0]
      ? evt.touches[0]
      : 'changedTouches' in evt && evt.changedTouches[0]
        ? evt.changedTouches[0]
        : (evt as MouseEvent);

  const sx = t.clientX - (rect.left + rect.width / 2);
  const sy = t.clientY - (rect.top + rect.height / 2);

  // Undo perspective(D) rotateX(TILT_DEG) [rotateZ(180deg)] to recover
  // the local (pre-transform) canvas point that projects to this screen
  // point. Derivation: a local (x, y, 0) point first optionally flips
  // to (-x, -y) via rotateZ(180deg), then rotates about the x-axis to
  // (x', y*cosA, y*sinA), then perspective-divides by (1 - z/D) to
  // reach screen space. Solving that chain for (x, y) given (sx, sy)
  // yields the closed form below.
  const cosA = Math.cos(TILT_RAD);
  const sinA = Math.sin(TILT_RAD);
  const y1 = sy / (cosA + (sy * sinA) / PERSPECTIVE_PX);
  const x1 = sx * (1 - (y1 * sinA) / PERSPECTIVE_PX);
  const lx = isFlipped.value ? -x1 : x1;
  const ly = isFlipped.value ? -y1 : y1;

  return { x: lx + boardW / 2, y: ly + boardH / 2 };
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
        <canvas ref="canvasEl" class="olo-canvas" :style="{ transform: canvasTransform }" />
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
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-style: italic;
  font-size: clamp(48px, 12vw, 84px);
  letter-spacing: -2px;
  line-height: 0.9;
  color: var(--color-text);
}

.olo-wordmark span {
  color: #e0562a;
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
  font-family: Georgia, serif;
  font-style: italic;
  font-weight: 700;
  color: var(--color-text);
}

.olo-scores {
  display: flex;
  gap: 0.5rem;
}

.olo-score-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  opacity: 0.6;
}

.olo-score-chip.current {
  opacity: 1;
  border-color: var(--color-primary);
  color: var(--color-text);
}

.olo-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.olo-board-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 0.58;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 20px 40px -16px rgba(0, 0, 0, 0.6);
}

.olo-canvas {
  touch-action: none;
}

.olo-toast {
  position: absolute;
  top: 10px;
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
  background: rgba(20, 17, 15, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1.25rem;
  border-radius: 12px;
  z-index: 20;
}

.olo-win-text {
  font-family: Georgia, serif;
  font-style: italic;
  font-weight: 700;
  font-size: 2rem;
  color: var(--color-text);
}
</style>
