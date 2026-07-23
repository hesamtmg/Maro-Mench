import { SnakesLaddersEngine } from './snakes-ladders.engine';
import { RoomPlayerSeat } from '../game-engine.interface';
import { BOARD_SIZE, DEFAULT_LADDERS, DEFAULT_SNAKES } from './board-config';

describe('SnakesLaddersEngine', () => {
  let engine: SnakesLaddersEngine;
  let seats: RoomPlayerSeat[];

  beforeEach(() => {
    engine = new SnakesLaddersEngine();
    seats = [
      { seatIndex: 0, userId: 'user-0' },
      { seatIndex: 1, userId: 'user-1' },
    ];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createInitialState', () => {
    it('starts every seat at square 0', () => {
      const state = engine.createInitialState(seats, {}) as any;
      expect(state.positions[0]).toBe(0);
      expect(state.positions[1]).toBe(0);
    });

    it('uses the default board unless a custom board is provided', () => {
      const state = engine.createInitialState(seats, {}) as any;
      expect(state.snakes).toEqual(DEFAULT_SNAKES);
      expect(state.ladders).toEqual(DEFAULT_LADDERS);
    });

    it('accepts a custom board via rules', () => {
      const customSnakes = { 50: 10 };
      const customLadders = { 5: 40 };
      const state = engine.createInitialState(seats, {
        customBoard: { snakes: customSnakes, ladders: customLadders },
      }) as any;
      expect(state.snakes).toEqual(customSnakes);
      expect(state.ladders).toEqual(customLadders);
    });
  });

  describe('movement', () => {
    it('moves a token forward by the dice value', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.positions[0] = 10;
      jest.spyOn(Math, 'random').mockReturnValue(0.0); // -> roll of 1
      const result = engine.rollDice(state, seats, 0);
      expect(result.diceValue).toBe(1);
      expect(result.moveResult?.movePayload.to).toBe(11);
    });

    it('does not move past square 100 (overshoot keeps same position)', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.positions[0] = 97; // plain square, no snake/ladder here
      jest.spyOn(Math, 'random').mockReturnValue(0.99); // -> roll of 6
      const result = engine.rollDice(state, seats, 0);
      expect(result.diceValue).toBe(6);
      expect(result.moveResult?.movePayload.to).toBe(97); // unchanged
    });

    it('lands exactly on 100 to win', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.positions[0] = 94;
      jest.spyOn(Math, 'random').mockReturnValue(0.99); // -> roll of 6
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.movePayload.to).toBe(BOARD_SIZE);
      expect(result.moveResult?.winnerSeat).toBe(0);
      expect(result.moveResult?.isGameOver).toBe(true);
    });
  });

  describe('snakes and ladders', () => {
    it('sends a token down a snake', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Snake at 16 -> 6 in default board. Move token to land exactly on 16.
      state.positions[0] = 10;
      jest.spyOn(Math, 'random').mockReturnValue((6 - 1) / 6); // roll of 6 -> 10+6=16
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.movePayload.to).toBe(DEFAULT_SNAKES[16]);
      expect(result.moveResult?.movePayload.landedOnSnakeOrLadder).toBe(true);
    });

    it('sends a token up a ladder', () => {
      const state = engine.createInitialState(seats, {}) as any;
      // Ladder at 9 -> 31 in default board. Token is already off the
      // checkpoint, so a plain roll of 4 lands exactly on it.
      state.positions[0] = 5;
      jest.spyOn(Math, 'random').mockReturnValue((4 - 1) / 6); // roll of 4 -> 5+4=9
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.movePayload.to).toBe(DEFAULT_LADDERS[9]);
      expect(result.moveResult?.movePayload.landedOnSnakeOrLadder).toBe(true);
    });
  });

  describe('checkpoint rule (must roll a six to leave home)', () => {
    it('stays at home on a non-six roll', () => {
      const state = engine.createInitialState(seats, {}) as any;
      jest.spyOn(Math, 'random').mockReturnValue(0.0); // roll of 1
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.movePayload.to).toBe(0);
      expect(result.moveResult?.movePayload.noLegalMove).toBe(true);
    });

    it('enters the board on a six, landing exactly on square 6', () => {
      const state = engine.createInitialState(seats, {}) as any;
      jest.spyOn(Math, 'random').mockReturnValue((6 - 1) / 6); // roll of 6
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.movePayload.to).toBe(6);
      expect(result.moveResult?.movePayload.noLegalMove).toBe(false);
    });
  });

  describe('reward rule (a six earns another roll)', () => {
    it('gives the same seat another turn after rolling a six', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.positions[0] = 10;
      jest.spyOn(Math, 'random').mockReturnValue((6 - 1) / 6); // roll of 6
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.nextTurnSeat).toBe(0);
    });

    it('caps extra turns at two consecutive sixes', () => {
      const state = engine.createInitialState(seats, {}) as any;
      state.positions[0] = 10;
      jest.spyOn(Math, 'random').mockReturnValue((6 - 1) / 6); // always roll 6

      const first = engine.rollDice(state, seats, 0);
      Object.assign(state, first.moveResult?.boardState);
      expect(first.moveResult?.nextTurnSeat).toBe(0);

      const second = engine.rollDice(state, seats, 0);
      Object.assign(state, second.moveResult?.boardState);
      expect(second.moveResult?.nextTurnSeat).toBe(0);

      const third = engine.rollDice(state, seats, 0);
      expect(third.moveResult?.nextTurnSeat).toBe(1);
    });
  });

  describe('turn order', () => {
    it('advances to the next seat after a normal move', () => {
      const state = engine.createInitialState(seats, {}) as any;
      jest.spyOn(Math, 'random').mockReturnValue(0.0); // roll of 1
      const result = engine.rollDice(state, seats, 0);
      expect(result.moveResult?.nextTurnSeat).toBe(1);
    });

    it('skips a finished player when computing the next seat', () => {
      const threeSeats: RoomPlayerSeat[] = [
        ...seats,
        { seatIndex: 2, userId: 'user-2' },
      ];
      const state = engine.createInitialState(threeSeats, {}) as any;
      state.finishedOrder = [1]; // seat 1 already finished
      jest.spyOn(Math, 'random').mockReturnValue(0.0); // roll of 1
      const result = engine.rollDice(state, threeSeats, 0);
      expect(result.moveResult?.nextTurnSeat).toBe(2); // skips seat 1
    });
  });

  describe('hasLegalMove', () => {
    it('is always true (no player choice in this game)', () => {
      const state = engine.createInitialState(seats, {}) as any;
      expect(engine.hasLegalMove(state, seats, 0, 4)).toBe(true);
    });
  });
});
