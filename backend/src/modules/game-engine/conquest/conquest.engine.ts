import { Injectable } from '@nestjs/common';
import {
  GameEngine,
  MoveResult,
  RollResult,
  RoomPlayerSeat,
} from '../game-engine.interface';
import {
  ADJACENCY,
  STARTING_ARMIES_BY_PLAYER_COUNT,
  TERRITORIES,
} from './board-config';

export type ConquestPhase = 'reinforce' | 'attack' | 'fortify';

export interface ConquestPlayerState {
  seatIndex: number;
  eliminated: boolean;
}

export interface ConquestState {
  owner: Record<string, number>;
  armies: Record<string, number>;
  players: Record<number, ConquestPlayerState>;
  currentTurnSeat: number;
  phase: ConquestPhase;
  reinforcementsRemaining: number;
}

export interface CombatResult {
  fromId: string;
  toId: string;
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
  captured: boolean;
  eliminatedSeat: number | null;
  isGameOver: boolean;
  winnerSeat: number | null;
}

function cloneState(state: ConquestState): ConquestState {
  return {
    owner: { ...state.owner },
    armies: { ...state.armies },
    players: Object.fromEntries(
      Object.entries(state.players).map(([k, v]) => [k, { ...v }]),
    ),
    currentTurnSeat: state.currentTurnSeat,
    phase: state.phase,
    reinforcementsRemaining: state.reinforcementsRemaining,
  };
}

function rollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

function rollDice(count: number): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie());
  return rolls.sort((a, b) => b - a);
}

function territoryCount(state: ConquestState, seatIndex: number): number {
  return Object.values(state.owner).filter((s) => s === seatIndex).length;
}

function reinforcementsFor(state: ConquestState, seatIndex: number): number {
  return Math.max(3, Math.floor(territoryCount(state, seatIndex) / 3));
}

function activeSeats(state: ConquestState): number[] {
  return Object.values(state.players)
    .filter((p) => !p.eliminated)
    .map((p) => p.seatIndex)
    .sort((a, b) => a - b);
}

function nextActiveSeat(state: ConquestState, fromSeat: number): number {
  const seats = activeSeats(state);
  const idx = seats.indexOf(fromSeat);
  return seats[(idx + 1) % seats.length];
}

// Whether `to` is reachable from `from` through a chain of territories all
// owned by `seatIndex` -- fortify's "owned corridor" rule.
function connectedThroughOwned(
  state: ConquestState,
  seatIndex: number,
  from: string,
  to: string,
): boolean {
  if (from === to) return false;
  const visited = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbor of ADJACENCY[current] ?? []) {
      if (visited.has(neighbor)) continue;
      if (state.owner[neighbor] !== seatIndex) continue;
      if (neighbor === to) return true;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return false;
}

/**
 * Conquest is a territory-conquest game (reinforce / attack / fortify)
 * with no turn-starting dice roll or discrete token move -- it doesn't fit
 * the rollDice/applyMove contract at all, same situation as OLO. Real
 * gameplay runs through the dedicated reinforce/attack/fortify/endTurn
 * methods below, invoked by their own gateway events.
 */
@Injectable()
export class ConquestEngine implements GameEngine {
  createInitialState(seats: RoomPlayerSeat[]): Record<string, unknown> {
    const sortedSeats = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
    const seatIndexes = sortedSeats.map((s) => s.seatIndex);

    const shuffled = [...TERRITORIES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const owner: Record<string, number> = {};
    const armies: Record<string, number> = {};
    shuffled.forEach((t, i) => {
      const seat = seatIndexes[i % seatIndexes.length];
      owner[t.id] = seat;
      armies[t.id] = 1;
    });

    const totalStart =
      STARTING_ARMIES_BY_PLAYER_COUNT[seatIndexes.length] ??
      STARTING_ARMIES_BY_PLAYER_COUNT[6];
    for (const seat of seatIndexes) {
      const ownedTerritories = TERRITORIES.filter((t) => owner[t.id] === seat).map(
        (t) => t.id,
      );
      let remaining = totalStart - ownedTerritories.length; // 1 already placed per territory
      while (remaining > 0) {
        const pick =
          ownedTerritories[Math.floor(Math.random() * ownedTerritories.length)];
        armies[pick] += 1;
        remaining -= 1;
      }
    }

    const players: Record<number, ConquestPlayerState> = {};
    for (const seat of seatIndexes) {
      players[seat] = { seatIndex: seat, eliminated: false };
    }

    const state: ConquestState = {
      owner,
      armies,
      players,
      currentTurnSeat: seatIndexes[0],
      phase: 'reinforce',
      reinforcementsRemaining: 0,
    };
    state.reinforcementsRemaining = reinforcementsFor(state, state.currentTurnSeat);

    return state as unknown as Record<string, unknown>;
  }

  rollDice(): RollResult {
    throw new Error(
      'Conquest has no turn-starting dice roll -- see reinforce/attack/fortify instead.',
    );
  }

  applyMove(): MoveResult {
    throw new Error(
      'Conquest has no discrete dice-driven move -- see reinforce/attack/fortify instead.',
    );
  }

  hasLegalMove(): boolean {
    return true;
  }

  /** Places `count` reinforcement armies on an owned territory during the reinforce phase. */
  reinforce(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    territoryId: string,
    count: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'reinforce') throw new Error('Not in the reinforce phase.');
    if (state.owner[territoryId] !== seatIndex) {
      throw new Error('You do not own that territory.');
    }
    if (count < 1) throw new Error('Must place at least one army.');
    if (count > state.reinforcementsRemaining) {
      throw new Error('Not enough reinforcements left.');
    }

    state.armies[territoryId] += count;
    state.reinforcementsRemaining -= count;
    if (state.reinforcementsRemaining === 0) {
      state.phase = 'attack';
    }

    return state as unknown as Record<string, unknown>;
  }

  /** Resolves one attack roll from `fromId` into the adjacent enemy `toId`. */
  attack(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    fromId: string,
    toId: string,
    attackerDiceCount: number,
  ): { boardState: Record<string, unknown>; combat: CombatResult } {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'attack') throw new Error('Not in the attack phase.');
    if (state.owner[fromId] !== seatIndex) {
      throw new Error('You do not own the attacking territory.');
    }
    if (state.owner[toId] === seatIndex) {
      throw new Error('You already own that territory.');
    }
    if (!(ADJACENCY[fromId] ?? []).includes(toId)) {
      throw new Error('Those territories are not adjacent.');
    }
    const attackerArmies = state.armies[fromId];
    if (attackerArmies < 2) {
      throw new Error('You need at least 2 armies to attack from there.');
    }
    const maxAttackerDice = Math.min(3, attackerArmies - 1);
    if (attackerDiceCount < 1 || attackerDiceCount > maxAttackerDice) {
      throw new Error(`You can attack with 1 to ${maxAttackerDice} dice here.`);
    }

    const defenderSeat = state.owner[toId];
    const defenderArmies = state.armies[toId];
    const defenderDiceCount = Math.min(2, defenderArmies);

    const attackerDice = rollDice(attackerDiceCount);
    const defenderDice = rollDice(defenderDiceCount);

    let attackerLosses = 0;
    let defenderLosses = 0;
    const pairs = Math.min(attackerDice.length, defenderDice.length);
    for (let i = 0; i < pairs; i++) {
      if (attackerDice[i] > defenderDice[i]) defenderLosses += 1;
      else attackerLosses += 1;
    }

    state.armies[fromId] -= attackerLosses;
    state.armies[toId] -= defenderLosses;

    let captured = false;
    let eliminatedSeat: number | null = null;

    if (state.armies[toId] <= 0) {
      captured = true;
      state.owner[toId] = seatIndex;
      // Classic minimum: move in exactly as many armies as attacking dice
      // rolled -- a v1 simplification (no separate "how many to move in"
      // prompt). Always leaves at least 1 army behind in the source.
      const moveIn = Math.min(attackerDiceCount, state.armies[fromId] - 1);
      state.armies[fromId] -= moveIn;
      state.armies[toId] = moveIn;

      if (territoryCount(state, defenderSeat) === 0) {
        state.players[defenderSeat].eliminated = true;
        eliminatedSeat = defenderSeat;
      }
    }

    let isGameOver = false;
    let winnerSeat: number | null = null;
    const remaining = activeSeats(state);
    if (remaining.length === 1) {
      isGameOver = true;
      winnerSeat = remaining[0];
    }

    return {
      boardState: state as unknown as Record<string, unknown>,
      combat: {
        fromId,
        toId,
        attackerDice,
        defenderDice,
        attackerLosses,
        defenderLosses,
        captured,
        eliminatedSeat,
        isGameOver,
        winnerSeat,
      },
    };
  }

  /** Voluntarily ends the attack phase (no more attacks this turn) and moves to fortify. */
  endAttackPhase(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'attack') throw new Error('Not in the attack phase.');
    state.phase = 'fortify';
    return state as unknown as Record<string, unknown>;
  }

  /** Moves armies once between two owned territories connected through owned land, ending the turn. */
  fortify(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    fromId: string,
    toId: string,
    count: number,
  ): MoveResult {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'fortify') throw new Error('Not in the fortify phase.');
    if (state.owner[fromId] !== seatIndex || state.owner[toId] !== seatIndex) {
      throw new Error('You must own both territories.');
    }
    if (count < 1 || count >= state.armies[fromId]) {
      throw new Error('Must leave at least one army behind.');
    }
    if (!connectedThroughOwned(state, seatIndex, fromId, toId)) {
      throw new Error('Those territories are not connected through land you own.');
    }

    state.armies[fromId] -= count;
    state.armies[toId] += count;

    return this.advanceTurn(state, { fortified: true, fromId, toId, count });
  }

  /** Ends the turn without fortifying (from the attack or fortify phase). */
  endTurn(boardStateIn: Record<string, unknown>, seatIndex: number): MoveResult {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase === 'reinforce') {
      throw new Error('Place all reinforcements before ending your turn.');
    }
    return this.advanceTurn(state, {});
  }

  /**
   * Stall protection for the turn-timeout scheduler: auto-places any
   * leftover reinforcements on the seat's strongest territory, then
   * force-ends the turn regardless of phase.
   */
  forceEndTurn(boardStateIn: Record<string, unknown>): MoveResult {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    const seatIndex = state.currentTurnSeat;
    let autoPlaced = 0;
    if (state.phase === 'reinforce' && state.reinforcementsRemaining > 0) {
      const owned = Object.entries(state.armies).filter(
        ([id]) => state.owner[id] === seatIndex,
      );
      if (owned.length > 0) {
        const [strongestId] = owned.sort((a, b) => b[1] - a[1])[0];
        state.armies[strongestId] += state.reinforcementsRemaining;
      }
      autoPlaced = state.reinforcementsRemaining;
      state.reinforcementsRemaining = 0;
    }
    return this.advanceTurn(state, { timedOut: true, autoPlaced });
  }

  private advanceTurn(
    state: ConquestState,
    movePayload: Record<string, unknown>,
  ): MoveResult {
    const seatIndex = state.currentTurnSeat;
    const next = nextActiveSeat(state, state.currentTurnSeat);
    state.currentTurnSeat = next;
    state.phase = 'reinforce';
    state.reinforcementsRemaining = reinforcementsFor(state, next);
    return {
      boardState: state as unknown as Record<string, unknown>,
      nextTurnSeat: next,
      isGameOver: false,
      movePayload: { ...movePayload, seatIndex },
    };
  }
}
