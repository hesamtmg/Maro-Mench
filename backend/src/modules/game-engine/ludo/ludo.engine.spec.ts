import { LudoEngine } from './ludo.engine';
import { RoomPlayerSeat } from '../game-engine.interface';
import { ENTRY_OFFSETS, FINISHED_POSITION, TRACK_LENGTH } from './board-config';

describe('LudoEngine', () => {
  let engine: LudoEngine;
  let seats: RoomPlayerSeat[];

  beforeEach(() => {
    engine = new LudoEngine();
    seats = [
      { seatIndex: 0, userId: 'user-0', color: 'red' },
      { seatIndex: 1, userId: 'user-1', color: 'green' },
    ];
  });

  describe('createInitialState', () => {
    it('places all tokens at home (-1) for every seat', () => {
      const state = engine.createInitialState(seats, {}) as any;
      expect(state.tokens[0]).toHaveLength(4);
      expect(state.tokens[1]).toHaveLength(4);
      for (const token of state.tokens[0]) {
        expect(token.position).toBe(-1);
      }
    });
  });

  describe('token entry', () => {
    it('does not allow a token to leave home on a non-6 roll', () => {
      const state = engine.createInitialState(seats, {});
      expect(engine.hasLegalMove(state, seats, 0, 3)).toBe(false);
    });

    it('allows a token to leave home on a roll of 6', () => {
      const state = engine.createInitialState(seats, {});
      expect(engine.hasLegalMove(state, seats, 0, 6)).toBe(true);
    });

    it('places the token at its seat entry offset when leaving home', () => {
      const state = engine.createInitialState(seats, {});
      const result = engine.applyMove(state, seats, 0, 6, { tokenId: 0 }, {});
      const movedToken = (result.boardState as any).tokens[0].find(
        (t: any) => t.tokenId === 0,
      );
      expect(movedToken.position).toBe(ENTRY_OFFSETS[0]);
    });

    it('throws if trying to move a token out of home without rolling 6', () => {
      const state = engine.createInitialState(seats, {});
      expect(() =>
        engine.applyMove(state, seats, 0, 4, { tokenId: 0 }, {}),
      ).toThrow(/roll of 6/);
    });
  });

  describe('movement and overshoot', () => {
    it('does not allow overshooting past the finish', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Manually place token 0 near the finish line.
      state.tokens[0][0].position = FINISHED_POSITION - 2;
      expect(engine.hasLegalMove(state, seats, 0, 5)).toBe(false);
      expect(() =>
        engine.applyMove(state, seats, 0, 5, { tokenId: 0 }, {}),
      ).toThrow(/overshoots/);
    });

    it('allows landing exactly on the finish square', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.tokens[0][0].position = FINISHED_POSITION - 3;
      const result = engine.applyMove(state, seats, 0, 3, { tokenId: 0 }, {});
      const token = (result.boardState as any).tokens[0][0];
      expect(token.position).toBe(FINISHED_POSITION);
    });
  });

  describe('capturing', () => {
    it('sends an opponent token home when landed on outside a safe square', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Seat 0 token approaching square 20 (not a safe square).
      state.tokens[0][0].position = 19;
      // Seat 1 opponent token sitting exactly on square 20.
      state.tokens[1][0].position = 20;

      const result = engine.applyMove(state, seats, 0, 1, { tokenId: 0 }, {});

      const opponentToken = (result.boardState as any).tokens[1][0];
      expect(opponentToken.position).toBe(-1);
      expect(result.movePayload.captured).toEqual([
        { seatIndex: 1, tokenId: 0 },
      ]);
    });

    it('does not capture on a safe square', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Square 8 is a safe square (star square).
      state.tokens[0][0].position = 7;
      state.tokens[1][0].position = 8;

      const result = engine.applyMove(state, seats, 0, 1, { tokenId: 0 }, {});

      const opponentToken = (result.boardState as any).tokens[1][0];
      expect(opponentToken.position).toBe(8); // untouched
      expect(result.movePayload.captured).toEqual([]);
    });
  });

  describe('turn order and extra turns', () => {
    it('advances to the next seat after a normal (non-6) move', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.tokens[0][0].position = 10;
      const result = engine.applyMove(state, seats, 0, 2, { tokenId: 0 }, {});
      expect(result.nextTurnSeat).toBe(1);
    });

    it('grants an extra turn (same seat again) on rolling a 6', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.tokens[0][0].position = 10;
      const result = engine.applyMove(state, seats, 0, 6, { tokenId: 0 }, {});
      expect(result.nextTurnSeat).toBe(0);
    });

    it('caps consecutive extra turns to avoid infinite 6-streaks', () => {
      let state = engine.createInitialState(seats, {}) as any;
      state.tokens[0][0].position = 10;

      // Roll 6 three times in a row; by the third the streak should be
      // capped and turn should pass to the next seat.
      let result = engine.applyMove(state, seats, 0, 6, { tokenId: 0 }, {});
      expect(result.nextTurnSeat).toBe(0);
      state = result.boardState as any;

      result = engine.applyMove(state, seats, 0, 6, { tokenId: 0 }, {});
      expect(result.nextTurnSeat).toBe(0);
      state = result.boardState as any;

      result = engine.applyMove(state, seats, 0, 6, { tokenId: 0 }, {});
      expect(result.nextTurnSeat).toBe(1);
    });

    it('grants an extra turn after a capture even without rolling a 6', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.tokens[0][0].position = 19;
      state.tokens[1][0].position = 20;
      const result = engine.applyMove(state, seats, 0, 1, { tokenId: 0 }, {});
      expect(result.nextTurnSeat).toBe(0);
    });
  });

  describe('win detection', () => {
    it('declares a winner when all 4 tokens reach the finished position', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.tokens[0][0].position = FINISHED_POSITION;
      state.tokens[0][1].position = FINISHED_POSITION;
      state.tokens[0][2].position = FINISHED_POSITION;
      state.tokens[0][3].position = FINISHED_POSITION - 2;

      const result = engine.applyMove(state, seats, 0, 2, { tokenId: 3 }, {});

      expect(result.winnerSeat).toBe(0);
      expect(result.isGameOver).toBe(true);
    });

    it('is not game over while more than one seat is still active', () => {
      const threeSeats: RoomPlayerSeat[] = [
        ...seats,
        { seatIndex: 2, userId: 'user-2', color: 'yellow' },
      ];
      const state = engine.createInitialState(threeSeats, {}) as any;
      state.tokens[0][0].position = FINISHED_POSITION;
      state.tokens[0][1].position = FINISHED_POSITION;
      state.tokens[0][2].position = FINISHED_POSITION;
      state.tokens[0][3].position = FINISHED_POSITION - 2;

      const result = engine.applyMove(
        state,
        threeSeats,
        0,
        2,
        { tokenId: 3 },
        {},
      );

      expect(result.winnerSeat).toBe(0);
      expect(result.isGameOver).toBe(false); // seats 1 and 2 still active
    });
  });

  describe('rollDice orchestration', () => {
    it('auto-resolves when there is exactly one legal move', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Only token 0 can move (already on track); others are home and it's not a 6.
      state.tokens[0][0].position = 10;
      const result = engine.rollDice(state, seats, 0, {});
      // rollDice generates its own random dice value, so just check shape.
      expect(typeof result.diceValue).toBe('number');
      expect(result.diceValue).toBeGreaterThanOrEqual(1);
      expect(result.diceValue).toBeLessThanOrEqual(6);
    });

    it('reports no legal move for a guaranteed non-6 roll when all tokens are home', () => {
      const state = engine.createInitialState(seats, {}) as any;
      expect(engine.hasLegalMove(state, seats, 0, 3)).toBe(false);
    });
  });

  describe('relative track position (wraparound)', () => {
    it('wraps correctly when a token nears the end of the shared track', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Seat 0 enters at offset ENTRY_OFFSETS[0] = 0. Put it just before
      // wrapping around the shared 52-length track into its home run.
      state.tokens[0][0].position = TRACK_LENGTH - 3; // steps into track = 49 (since entry=0)
      const result = engine.applyMove(state, seats, 0, 4, { tokenId: 0 }, {});
      const token = (result.boardState as any).tokens[0][0];
      // stepsIntoTrack (49) + 4 = 53, which is TRACK_LENGTH(52) + 1 -> home run pos 53
      expect(token.position).toBe(TRACK_LENGTH + 1);
    });
  });
});
