import { Injectable } from '@nestjs/common';
import {
  GameEngine,
  MoveResult,
  RoomPlayerSeat,
  RollResult,
} from '../game-engine.interface';
import {
  ENTRY_OFFSETS,
  FINISHED_POSITION,
  HOME_RUN_LENGTH,
  SAFE_SQUARES,
  TOKENS_PER_PLAYER,
  TRACK_LENGTH,
} from './board-config';

// Token position encoding:
//   -1           = still at home (not yet entered)
//   0..51        = position on the shared outer track (absolute square)
//   52..57       = position within own home run (relative)
//   58           = finished
interface LudoToken {
  tokenId: number; // 0-3 within the seat
  position: number;
}

interface LudoState {
  tokens: Record<number, LudoToken[]>; // seatIndex -> 4 tokens
  consecutiveSixes: Record<number, number>; // seatIndex -> count this turn-chain
  finishedOrder: number[];
}

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

@Injectable()
export class LudoEngine implements GameEngine {
  createInitialState(seats: RoomPlayerSeat[]): Record<string, unknown> {
    const tokens: Record<number, LudoToken[]> = {};
    const consecutiveSixes: Record<number, number> = {};
    for (const seat of seats) {
      tokens[seat.seatIndex] = Array.from(
        { length: TOKENS_PER_PLAYER },
        (_, tokenId) => ({ tokenId, position: -1 }),
      );
      consecutiveSixes[seat.seatIndex] = 0;
    }
    const state: LudoState = { tokens, consecutiveSixes, finishedOrder: [] };
    return state as unknown as Record<string, unknown>;
  }

  rollDice(
    boardState: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
  ): RollResult {
    const diceValue = rollDie();
    const state = boardState as unknown as LudoState;

    const movableTokens = this.getMovableTokens(state, seatIndex, diceValue);

    // No legal moves at all: turn passes automatically, nothing to choose.
    if (movableTokens.length === 0) {
      const nextTurnSeat = this.getNextSeat(
        seats,
        seatIndex,
        diceValue,
        state,
        false,
      );
      return {
        diceValue,
        autoResolved: true,
        moveResult: {
          boardState: state as unknown as Record<string, unknown>,
          nextTurnSeat,
          isGameOver: false,
          movePayload: { rolled: diceValue, noLegalMove: true },
        },
      };
    }

    // Exactly one movable token and it's not a "choose which to move"
    // situation in a meaningful way only if there's truly one option —
    // still let the client confirm which token, since captures/strategy
    // matter even with a single option in some UIs. We auto-resolve only
    // when there's genuinely one legal token to keep flow snappy.
    if (movableTokens.length === 1) {
      const moveResult = this.applyMove(
        state as unknown as Record<string, unknown>,
        seats,
        seatIndex,
        diceValue,
        { tokenId: movableTokens[0] },
        {},
      );
      return { diceValue, autoResolved: true, moveResult };
    }

    // Multiple legal options: client must call applyMove with a choice.
    return { diceValue, autoResolved: false };
  }

  applyMove(
    boardState: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
    diceValue: number,
    movePayload: Record<string, unknown>,
    _rules: Record<string, unknown>,
  ): MoveResult {
    const state = structuredClone(boardState) as unknown as LudoState;
    const tokenId = movePayload.tokenId as number;
    const token = state.tokens[seatIndex]?.find((t) => t.tokenId === tokenId);
    if (!token) {
      throw new Error('Invalid tokenId for this seat');
    }

    const fromPosition = token.position;
    const captured: Array<{ seatIndex: number; tokenId: number }> = [];

    if (token.position === -1) {
      // Entering from home requires a 6.
      if (diceValue !== 6) {
        throw new Error('Token can only leave home on a roll of 6');
      }
      token.position = ENTRY_OFFSETS[seatIndex];
    } else if (token.position < TRACK_LENGTH) {
      // On the shared track — moving may wrap into the home run.
      const stepsIntoTrack = this.relativeTrackPosition(
        token.position,
        seatIndex,
      );
      const newStepsIntoTrack = stepsIntoTrack + diceValue;
      if (newStepsIntoTrack > TRACK_LENGTH + HOME_RUN_LENGTH - 1) {
        throw new Error('Move overshoots the finish');
      }
      if (newStepsIntoTrack >= TRACK_LENGTH) {
        // Entered home run (or finished exactly).
        token.position = TRACK_LENGTH + (newStepsIntoTrack - TRACK_LENGTH);
      } else {
        token.position =
          (ENTRY_OFFSETS[seatIndex] + newStepsIntoTrack) % TRACK_LENGTH;
      }
    } else {
      // Already in home run.
      const newPos = token.position + diceValue;
      if (newPos > FINISHED_POSITION) {
        throw new Error('Move overshoots the finish');
      }
      token.position = newPos;
    }

    // Capture logic: only applies when landing on the shared track and
    // the square isn't a safe square.
    if (token.position < TRACK_LENGTH && !SAFE_SQUARES.has(token.position)) {
      for (const seat of seats) {
        if (seat.seatIndex === seatIndex) continue;
        const opponentTokens = state.tokens[seat.seatIndex] ?? [];
        for (const oppToken of opponentTokens) {
          if (
            oppToken.position === token.position &&
            oppToken.position < TRACK_LENGTH
          ) {
            oppToken.position = -1; // sent home
            captured.push({
              seatIndex: seat.seatIndex,
              tokenId: oppToken.tokenId,
            });
          }
        }
      }
    }

    const allFinished = (state.tokens[seatIndex] ?? []).every(
      (t) => t.position === FINISHED_POSITION,
    );
    if (allFinished && !state.finishedOrder.includes(seatIndex)) {
      state.finishedOrder = [...state.finishedOrder, seatIndex];
    }

    const activeSeats = seats.filter(
      (s) => !state.finishedOrder.includes(s.seatIndex),
    );
    const isGameOver = activeSeats.length <= 1;

    const gotExtraTurn = diceValue === 6 || captured.length > 0;
    const nextTurnSeat = this.getNextSeat(
      seats,
      seatIndex,
      diceValue,
      state,
      gotExtraTurn,
    );

    return {
      boardState: state as unknown as Record<string, unknown>,
      nextTurnSeat,
      isGameOver,
      winnerSeat: allFinished ? seatIndex : undefined,
      movePayload: {
        tokenId,
        from: fromPosition,
        to: token.position,
        rolled: diceValue,
        captured,
      },
    };
  }

  hasLegalMove(
    boardState: Record<string, unknown>,
    _seats: RoomPlayerSeat[],
    seatIndex: number,
    diceValue: number,
  ): boolean {
    const state = boardState as unknown as LudoState;
    return this.getMovableTokens(state, seatIndex, diceValue).length > 0;
  }

  private getMovableTokens(
    state: LudoState,
    seatIndex: number,
    diceValue: number,
  ): number[] {
    const tokens = state.tokens[seatIndex] ?? [];
    const movable: number[] = [];

    for (const token of tokens) {
      if (token.position === FINISHED_POSITION) continue;

      if (token.position === -1) {
        if (diceValue === 6) movable.push(token.tokenId);
        continue;
      }

      if (token.position < TRACK_LENGTH) {
        const stepsIntoTrack = this.relativeTrackPosition(
          token.position,
          seatIndex,
        );
        if (stepsIntoTrack + diceValue <= TRACK_LENGTH + HOME_RUN_LENGTH - 1) {
          movable.push(token.tokenId);
        }
      } else {
        if (token.position + diceValue <= FINISHED_POSITION) {
          movable.push(token.tokenId);
        }
      }
    }

    return movable;
  }

  private relativeTrackPosition(
    absolutePosition: number,
    seatIndex: number,
  ): number {
    const entry = ENTRY_OFFSETS[seatIndex];
    return (absolutePosition - entry + TRACK_LENGTH) % TRACK_LENGTH;
  }

  private getNextSeat(
    seats: RoomPlayerSeat[],
    currentSeatIndex: number,
    diceValue: number,
    state: LudoState,
    gotExtraTurn: boolean,
  ): number {
    if (gotExtraTurn) {
      const chain = state.consecutiveSixes[currentSeatIndex] ?? 0;
      // Cap consecutive extra turns to avoid infinite turn hogging when a
      // player keeps rolling 6s. A capture-triggered extra turn doesn't
      // count against this cap since it isn't itself a 6.
      if (diceValue === 6) {
        if (chain < 2) {
          state.consecutiveSixes[currentSeatIndex] = chain + 1;
          return currentSeatIndex;
        }
        // Chain cap hit — fall through to advancing turn below.
      } else {
        // Extra turn from a capture (not a 6): always grant it, and reset
        // the six-streak counter since a non-6 was rolled.
        state.consecutiveSixes[currentSeatIndex] = 0;
        return currentSeatIndex;
      }
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
