import { Injectable } from '@nestjs/common';
import {
  GameEngine,
  MoveResult,
  RollResult,
  RoomPlayerSeat,
} from '../game-engine.interface';
import {
  DISC_R_MAX,
  DISC_R_MIN,
  DISCS_PER_PLAYER,
  DENSITY_MAX,
  DENSITY_MIN,
  MAX_USES,
  ZONE_FREE_H,
} from './board-config';

export type OloDiscClass = 'light' | 'medium' | 'heavy';

export interface OloDisc {
  id: string;
  owner: number; // seatIndex
  xFrac: number; // 0-1, fraction of board width
  yFrac: number; // 0-1, fraction of board height
  rFrac: number; // radius as a fraction of board width
  density: number;
  frictionAir: number;
  restitution: number;
  cls: OloDiscClass;
  alive: boolean;
  usesLeft: number;
  resting: boolean;
}

export interface OloState {
  discs: OloDisc[];
  scores: Record<number, number>;
  // Which seat stages at the top vs. bottom of the board -- fixed for
  // the whole match, needed so both clients agree on zone layout.
  topSeat: number;
  bottomSeat: number;
}

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

// One player's full 6-disc set: always exactly one very big/heavy, one
// very small/light, and four mid-range discs, shuffled so the extremes
// don't always land in the same staging slot.
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

/**
 * OLO is a real-time physics game (drag-and-flick discs), not a discrete
 * dice-and-move game -- it doesn't fit the rollDice/applyMove contract at
 * all. The client that's shooting runs the actual physics locally (via
 * Matter.js) and reports the settled result directly; game.gateway.ts
 * relays that between clients and persists it as boardState through the
 * same GameStateService every other engine uses, bypassing rollDice/
 * applyMove entirely for this game type.
 *
 * The one piece of real server-side logic this engine provides is
 * createInitialState: generating both players' disc sets once, so every
 * client starts from the exact same discs instead of each generating
 * their own random set and immediately disagreeing.
 */
@Injectable()
export class OloEngine implements GameEngine {
  createInitialState(seats: RoomPlayerSeat[]): Record<string, unknown> {
    const sorted = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
    const topSeat = sorted[0]?.seatIndex ?? 0;
    const bottomSeat = sorted[1]?.seatIndex ?? 1;

    const discs = [
      ...stageDiscs(topSeat, ZONE_FREE_H / 2),
      ...stageDiscs(bottomSeat, 1 - ZONE_FREE_H / 2),
    ];

    const state: OloState = {
      discs,
      scores: { [topSeat]: 0, [bottomSeat]: 0 },
      topSeat,
      bottomSeat,
    };
    return state as unknown as Record<string, unknown>;
  }

  rollDice(): RollResult {
    throw new Error(
      'OLO has no dice -- shots are relayed directly via dedicated OLO_* socket events, not rollDice.',
    );
  }

  applyMove(): MoveResult {
    throw new Error(
      'OLO has no discrete moves -- shot results are relayed directly via dedicated OLO_* socket events, not applyMove.',
    );
  }

  hasLegalMove(): boolean {
    // No dice/turn-choice concept here; always "true" to satisfy callers
    // that check this defensively.
    return true;
  }
}
