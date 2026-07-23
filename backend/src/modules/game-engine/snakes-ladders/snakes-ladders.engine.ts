import { Injectable } from '@nestjs/common';
import {
  GameEngine,
  MoveResult,
  RoomPlayerSeat,
  RollResult,
} from '../game-engine.interface';
import { BOARD_SIZE, DEFAULT_LADDERS, DEFAULT_SNAKES } from './board-config';

interface SnakesLaddersState {
  positions: Record<number, number>; // seatIndex -> square (0 = not started)
  snakes: Record<number, number>;
  ladders: Record<number, number>;
  finishedOrder: number[]; // seatIndex order in which players finished
  consecutiveSixes: Record<number, number>; // seatIndex -> count this turn-chain
}

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

@Injectable()
export class SnakesLaddersEngine implements GameEngine {
  createInitialState(
    seats: RoomPlayerSeat[],
    rules: Record<string, unknown>,
  ): Record<string, unknown> {
    const positions: Record<number, number> = {};
    const consecutiveSixes: Record<number, number> = {};
    for (const seat of seats) {
      positions[seat.seatIndex] = 0;
      consecutiveSixes[seat.seatIndex] = 0;
    }

    const useCustomBoard = rules?.customBoard as
      | { snakes?: Record<number, number>; ladders?: Record<number, number> }
      | undefined;

    const state: SnakesLaddersState = {
      positions,
      snakes: useCustomBoard?.snakes ?? DEFAULT_SNAKES,
      ladders: useCustomBoard?.ladders ?? DEFAULT_LADDERS,
      finishedOrder: [],
      consecutiveSixes,
    };

    return state as unknown as Record<string, unknown>;
  }

  rollDice(
    boardState: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
  ): RollResult {
    const diceValue = rollDie();
    const state = boardState as unknown as SnakesLaddersState;
    // Backfill for games already in progress when this field was added --
    // their persisted boardState predates it and won't have it otherwise.
    if (!state.consecutiveSixes) {
      state.consecutiveSixes = {};
    }

    const currentPos = state.positions[seatIndex] ?? 0;
    let newPos = currentPos;
    let noLegalMove = false;

    if (currentPos === 0) {
      // Checkpoint rule: a token stays home until its owner rolls a six.
      // That same six is also the move -- it lands exactly on square 6,
      // not "6 plus whatever square 0 would imply".
      if (diceValue === 6) {
        newPos = 6;
      } else {
        noLegalMove = true;
      }
    } else {
      newPos = currentPos + diceValue;
      // Must land exactly on the final square; overshoot means no move.
      if (newPos > BOARD_SIZE) {
        newPos = currentPos;
        noLegalMove = true;
      }
    }

    let landedOnSnakeOrLadder = false;
    if (state.snakes[newPos] !== undefined) {
      newPos = state.snakes[newPos];
      landedOnSnakeOrLadder = true;
    } else if (state.ladders[newPos] !== undefined) {
      newPos = state.ladders[newPos];
      landedOnSnakeOrLadder = true;
    }

    const newState: SnakesLaddersState = {
      ...state,
      positions: { ...state.positions, [seatIndex]: newPos },
    };

    const isWinner = newPos === BOARD_SIZE;
    if (isWinner) {
      newState.finishedOrder = [...state.finishedOrder, seatIndex];
    }

    const activeSeats = seats.filter(
      (s) => !newState.finishedOrder.includes(s.seatIndex),
    );
    const isGameOver = activeSeats.length <= 1 && seats.length > 1;

    // Reward rule: rolling a six earns another roll, same as Ludo --
    // capped at two extra rolls in a row so a lucky streak can't hog the
    // game forever.
    const nextTurnSeat = this.getNextSeat(
      seats,
      seatIndex,
      diceValue,
      newState,
    );

    return {
      diceValue,
      autoResolved: true,
      moveResult: {
        boardState: newState as unknown as Record<string, unknown>,
        nextTurnSeat,
        isGameOver: isGameOver || (isWinner === true && seats.length === 1),
        winnerSeat: isWinner ? seatIndex : undefined,
        movePayload: {
          from: currentPos,
          rolled: diceValue,
          to: newPos,
          landedOnSnakeOrLadder,
          noLegalMove,
        },
      },
    };
  }

  applyMove(
    _boardState: Record<string, unknown>,
    _seats: RoomPlayerSeat[],
    _seatIndex: number,
    _diceValue: number,
    _movePayload: Record<string, unknown>,
    _rules: Record<string, unknown>,
  ): MoveResult {
    // Snakes & Ladders has no player-choice moves — rollDice fully resolves
    // each turn. This exists only to satisfy the GameEngine interface.
    throw new Error(
      'Snakes & Ladders does not support applyMove; rollDice auto-resolves.',
    );
  }

  hasLegalMove(): boolean {
    // Always "legal" — either you move or you don't (overshoot), but you
    // never get to choose, so there's nothing to validate here.
    return true;
  }

  private getNextSeat(
    seats: RoomPlayerSeat[],
    currentSeatIndex: number,
    diceValue: number,
    state: SnakesLaddersState,
  ): number {
    if (diceValue === 6) {
      const chain = state.consecutiveSixes[currentSeatIndex] ?? 0;
      if (chain < 2) {
        state.consecutiveSixes[currentSeatIndex] = chain + 1;
        return currentSeatIndex;
      }
      // Chain cap hit -- fall through to advancing the turn below.
    }
    state.consecutiveSixes[currentSeatIndex] = 0;

    const sortedSeats = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
    const activeSeats = sortedSeats.filter(
      (s) => !state.finishedOrder.includes(s.seatIndex),
    );
    if (activeSeats.length === 0) return currentSeatIndex;

    const currentIdxInActive = activeSeats.findIndex(
      (s) => s.seatIndex === currentSeatIndex,
    );
    if (currentIdxInActive === -1) {
      return activeSeats[0].seatIndex;
    }
    const nextIdx = (currentIdxInActive + 1) % activeSeats.length;
    return activeSeats[nextIdx].seatIndex;
  }
}
