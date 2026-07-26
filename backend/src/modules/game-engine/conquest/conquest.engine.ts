import { Injectable } from '@nestjs/common';
import {
  GameEngine,
  MoveResult,
  RollResult,
  RoomPlayerSeat,
} from '../game-engine.interface';
import {
  ADJACENCY,
  CARD_DECK,
  CONTINENTS,
  STARTING_ARMIES_BY_PLAYER_COUNT,
  TERRITORIES,
  type CardDef,
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
  deck: CardDef[];
  discard: CardDef[];
  hands: Record<number, CardDef[]>;
  cardsTradedInCount: number;
  // Whether the current turn's player has captured at least one territory
  // so far this turn -- drives whether they draw a card when the turn ends.
  capturedTerritoryThisTurn: boolean;
  // Reinforcements placed on each territory so far *this* reinforce phase
  // (pool placements only, not moveArmies repositioning or card-trade
  // bonuses) -- lets a misclick be undone via resetReinforcements. Cleared
  // at the start of every reinforce phase.
  reinforcementsPlacedThisTurn: Record<string, number>;
  // Set to the from/to pair of the territory just captured by the most
  // recent attack roll, so the attacker can optionally move in more than
  // the automatic minimum before attacking again -- classic Risk's
  // "how many armies to occupy with" choice. Cleared by any further
  // attack roll (successful or not) or by leaving the attack phase, since
  // the choice is only available in the moment right after that capture.
  lastCaptureFromId: string | null;
  lastCaptureToId: string | null;
}

// Bonus reinforcement armies for the Nth set traded in (0-indexed),
// following the classic escalating schedule: 4,6,8,10,12,15, then +5 per
// further trade-in (20,25,30,...).
const TRADE_IN_BASE_BONUSES = [4, 6, 8, 10, 12, 15];

function bonusForTradeIn(tradeInIndex: number): number {
  if (tradeInIndex < TRADE_IN_BASE_BONUSES.length) {
    return TRADE_IN_BASE_BONUSES[tradeInIndex];
  }
  const last = TRADE_IN_BASE_BONUSES[TRADE_IN_BASE_BONUSES.length - 1];
  return last + 5 * (tradeInIndex - TRADE_IN_BASE_BONUSES.length + 1);
}

// A set is valid if all three symbols match, all three differ, or a
// wildcard fills in for whichever pattern the other two cards support --
// with only three non-wild symbols total, any hand containing at least
// one wildcard always satisfies one of the two patterns.
function isValidCardSet(cards: CardDef[]): boolean {
  if (cards.length !== 3) return false;
  if (cards.some((c) => c.symbol === 'wild')) return true;
  const [a, b, c] = cards.map((x) => x.symbol);
  const allSame = a === b && b === c;
  const allDifferent = a !== b && b !== c && a !== c;
  return allSame || allDifferent;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
    deck: [...state.deck],
    discard: [...state.discard],
    hands: Object.fromEntries(
      Object.entries(state.hands).map(([k, v]) => [k, [...v]]),
    ),
    cardsTradedInCount: state.cardsTradedInCount,
    capturedTerritoryThisTurn: state.capturedTerritoryThisTurn,
    reinforcementsPlacedThisTurn: { ...state.reinforcementsPlacedThisTurn },
    lastCaptureFromId: state.lastCaptureFromId,
    lastCaptureToId: state.lastCaptureToId,
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

function continentBonusFor(state: ConquestState, seatIndex: number): number {
  let bonus = 0;
  for (const continent of CONTINENTS) {
    const members = TERRITORIES.filter((t) => t.continentId === continent.id);
    if (members.every((t) => state.owner[t.id] === seatIndex)) {
      bonus += continent.bonus;
    }
  }
  return bonus;
}

function reinforcementsFor(state: ConquestState, seatIndex: number): number {
  return (
    Math.max(3, Math.floor(territoryCount(state, seatIndex) / 3)) +
    continentBonusFor(state, seatIndex)
  );
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
    const hands: Record<number, CardDef[]> = {};
    for (const seat of seatIndexes) {
      players[seat] = { seatIndex: seat, eliminated: false };
      hands[seat] = [];
    }

    const state: ConquestState = {
      owner,
      armies,
      players,
      currentTurnSeat: seatIndexes[0],
      phase: 'reinforce',
      reinforcementsRemaining: 0,
      deck: shuffle(CARD_DECK),
      discard: [],
      hands,
      cardsTradedInCount: 0,
      capturedTerritoryThisTurn: false,
      reinforcementsPlacedThisTurn: {},
      lastCaptureFromId: null,
      lastCaptureToId: null,
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
    if ((state.hands[seatIndex]?.length ?? 0) >= 5) {
      throw new Error('You have 5 or more cards -- trade in a set before placing reinforcements.');
    }
    if (state.owner[territoryId] !== seatIndex) {
      throw new Error('You do not own that territory.');
    }
    if (count < 1) throw new Error('Must place at least one army.');
    if (count > state.reinforcementsRemaining) {
      throw new Error('Not enough reinforcements left.');
    }

    state.armies[territoryId] += count;
    state.reinforcementsRemaining -= count;
    state.reinforcementsPlacedThisTurn[territoryId] =
      (state.reinforcementsPlacedThisTurn[territoryId] ?? 0) + count;
    if (state.reinforcementsRemaining === 0) {
      state.phase = 'attack';
    }

    return state as unknown as Record<string, unknown>;
  }

  /**
   * Undoes every reinforcement placed on the pool so far this reinforce
   * phase, returning the armies to reinforcementsRemaining. Only reverts
   * reinforce()'s pool placements -- not moveArmies repositioning or
   * card-trade bonuses -- and only while still in the reinforce phase (once
   * the last army placed auto-advances to attack, there's nothing left to
   * reset).
   */
  resetReinforcements(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'reinforce') throw new Error('Not in the reinforce phase.');

    let restored = 0;
    for (const [territoryId, count] of Object.entries(state.reinforcementsPlacedThisTurn)) {
      state.armies[territoryId] -= count;
      restored += count;
    }
    state.reinforcementsRemaining += restored;
    state.reinforcementsPlacedThisTurn = {};

    return state as unknown as Record<string, unknown>;
  }

  /**
   * Freely repositions armies between two territories the player already
   * owns, during the reinforce or fortify phase -- no adjacency or
   * connected-path requirement, and it doesn't end the turn or consume the
   * phase, so it can be called as many times as the player likes. At least
   * one army must stay behind so a territory is never left empty.
   */
  moveArmies(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    fromId: string,
    toId: string,
    count: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'reinforce' && state.phase !== 'fortify') {
      throw new Error('Not in the reinforce or fortify phase.');
    }
    if (fromId === toId) throw new Error('Pick two different territories.');
    if (state.owner[fromId] !== seatIndex || state.owner[toId] !== seatIndex) {
      throw new Error('You do not own that territory.');
    }
    if (count < 1) throw new Error('Must move at least one army.');
    if (count > state.armies[fromId] - 1) {
      throw new Error('You must leave at least one army behind.');
    }

    state.armies[fromId] -= count;
    state.armies[toId] += count;

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
    // Any attack roll -- win, loss, or draw -- closes the previous
    // capture's occupation-choice window; it's only open in the moment
    // right after that specific capture.
    state.lastCaptureFromId = null;
    state.lastCaptureToId = null;

    if (state.armies[toId] <= 0) {
      captured = true;
      state.owner[toId] = seatIndex;
      state.capturedTerritoryThisTurn = true;
      // Classic minimum: move in exactly as many armies as attacking dice
      // rolled. The player can move in more via occupyCapturedTerritory,
      // up to leaving 1 behind in the source, as long as they do it before
      // their next attack roll.
      const moveIn = Math.min(attackerDiceCount, state.armies[fromId] - 1);
      state.armies[fromId] -= moveIn;
      state.armies[toId] = moveIn;
      state.lastCaptureFromId = fromId;
      state.lastCaptureToId = toId;

      if (territoryCount(state, defenderSeat) === 0) {
        state.players[defenderSeat].eliminated = true;
        eliminatedSeat = defenderSeat;
        // Classic rule: eliminating a player hands you their whole hand.
        state.hands[seatIndex] = [
          ...(state.hands[seatIndex] ?? []),
          ...(state.hands[defenderSeat] ?? []),
        ];
        state.hands[defenderSeat] = [];
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

  /**
   * Moves additional armies from the attacking territory into the one just
   * captured, on top of the automatic minimum already moved in -- classic
   * Risk's "how many armies to occupy with" choice. Only valid right after
   * that specific capture (closed by the next attack roll or leaving the
   * attack phase); always leaves at least 1 army behind in the source.
   */
  occupyCapturedTerritory(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    additionalCount: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'attack') throw new Error('Not in the attack phase.');
    if (!state.lastCaptureFromId || !state.lastCaptureToId) {
      throw new Error('No territory was just captured to occupy.');
    }
    if (state.owner[state.lastCaptureFromId] !== seatIndex) {
      throw new Error('You do not own that territory.');
    }
    if (additionalCount < 1) throw new Error('Must move at least one army.');
    if (additionalCount > state.armies[state.lastCaptureFromId] - 1) {
      throw new Error('You must leave at least one army behind.');
    }

    state.armies[state.lastCaptureFromId] -= additionalCount;
    state.armies[state.lastCaptureToId] += additionalCount;

    return state as unknown as Record<string, unknown>;
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
    state.lastCaptureFromId = null;
    state.lastCaptureToId = null;
    return state as unknown as Record<string, unknown>;
  }

  /**
   * Trades in a matched set of 3 cards during the reinforce phase for an
   * escalating reinforcement bonus. If one of the traded cards pictures a
   * territory the seat currently owns, that territory also gets +2 armies
   * placed directly on it.
   */
  tradeInCards(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    cardIds: string[],
  ): { boardState: Record<string, unknown>; bonus: number; territoryBonusId: string | null } {
    const state = cloneState(boardStateIn as unknown as ConquestState);
    if (state.currentTurnSeat !== seatIndex) throw new Error('It is not your turn.');
    if (state.phase !== 'reinforce') {
      throw new Error('You can only trade in cards during the reinforce phase.');
    }
    if (cardIds.length !== 3) throw new Error('Trade in exactly 3 cards.');

    const hand = state.hands[seatIndex] ?? [];
    const uniqueIds = new Set(cardIds);
    if (uniqueIds.size !== 3) throw new Error('Choose 3 different cards.');
    const cards = cardIds.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error('You do not hold one of those cards.');
    const tradedCards = cards as CardDef[];
    if (!isValidCardSet(tradedCards)) {
      throw new Error(
        'Those cards are not a valid set (three matching symbols, one of each, or wildcards filling in).',
      );
    }

    const bonus = bonusForTradeIn(state.cardsTradedInCount);
    state.cardsTradedInCount += 1;
    state.reinforcementsRemaining += bonus;

    let territoryBonusId: string | null = null;
    for (const card of tradedCards) {
      if (card.territoryId && state.owner[card.territoryId] === seatIndex) {
        state.armies[card.territoryId] += 2;
        territoryBonusId = card.territoryId;
        break;
      }
    }

    state.hands[seatIndex] = hand.filter((c) => !uniqueIds.has(c.id));
    state.discard = [...state.discard, ...tradedCards];

    return {
      boardState: state as unknown as Record<string, unknown>,
      bonus,
      territoryBonusId,
    };
  }

  /** Ends the turn (from the attack or fortify phase) -- fortifying itself no longer ends the turn, see moveArmies. */
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

  /** Draws one card for the seat ending their turn, reshuffling the discard pile back into the deck if the deck's empty. */
  private drawCard(state: ConquestState): CardDef | null {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) return null;
      state.deck = shuffle(state.discard);
      state.discard = [];
    }
    return state.deck.pop() ?? null;
  }

  private advanceTurn(
    state: ConquestState,
    movePayload: Record<string, unknown>,
  ): MoveResult {
    const seatIndex = state.currentTurnSeat;

    let drewCard: CardDef | null = null;
    if (state.capturedTerritoryThisTurn) {
      drewCard = this.drawCard(state);
      if (drewCard) {
        state.hands[seatIndex] = [...(state.hands[seatIndex] ?? []), drewCard];
      }
    }
    state.capturedTerritoryThisTurn = false;

    const next = nextActiveSeat(state, state.currentTurnSeat);
    state.currentTurnSeat = next;
    state.phase = 'reinforce';
    state.reinforcementsRemaining = reinforcementsFor(state, next);
    state.reinforcementsPlacedThisTurn = {};
    state.lastCaptureFromId = null;
    state.lastCaptureToId = null;
    return {
      boardState: state as unknown as Record<string, unknown>,
      nextTurnSeat: next,
      isGameOver: false,
      movePayload: { ...movePayload, seatIndex, drewCard },
    };
  }
}
