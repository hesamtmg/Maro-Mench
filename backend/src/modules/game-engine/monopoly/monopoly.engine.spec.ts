import { MonopolyEngine, MonopolyState } from './monopoly.engine';
import { RoomPlayerSeat } from '../game-engine.interface';
import { BOARD, JAIL_SPACE_INDEX, STARTING_CASH } from './board-config';

function mockDiceOnce(d1: number, d2: number) {
  const r1 = (d1 - 0.5) / 6;
  const r2 = (d2 - 0.5) / 6;
  return jest.spyOn(Math, 'random').mockReturnValueOnce(r1).mockReturnValueOnce(r2);
}

describe('MonopolyEngine', () => {
  let engine: MonopolyEngine;
  let seats: RoomPlayerSeat[];

  beforeEach(() => {
    engine = new MonopolyEngine();
    seats = [
      { seatIndex: 0, userId: 'user-0' },
      { seatIndex: 1, userId: 'user-1' },
    ];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createInitialState', () => {
    it('gives every seat the starting cash and position 0', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      expect(state.players[0].cash).toBe(STARTING_CASH);
      expect(state.players[1].cash).toBe(STARTING_CASH);
      expect(state.players[0].position).toBe(0);
      expect(state.properties[1].ownerSeat).toBeNull();
    });

    it('honors a custom starting cash rule', () => {
      const state = engine.createInitialState(seats, {
        startingCash: 500,
      }) as unknown as MonopolyState;
      expect(state.players[0].cash).toBe(500);
    });
  });

  describe('movement', () => {
    it('moves a token forward by the dice sum', () => {
      const state = engine.createInitialState(seats, {});
      mockDiceOnce(1, 2); // sum 3
      const result = engine.rollDice(state, seats, 0);
      expect(result.diceValue).toBe(3);
      expect(result.moveResult?.movePayload.to).toBe(3);
    });

    it('awards the Go bonus when crossing or landing on Go', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].position = 38;
      mockDiceOnce(1, 2); // sum 3 -> wraps to square 1
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].position).toBe(1);
      // Go bonus only -- landing on an unowned property just offers the
      // purchase, it doesn't auto-buy.
      expect(after.players[0].cash).toBe(STARTING_CASH + 200);
      expect(after.pendingPurchase).toEqual({ spaceIndex: 1, price: 60 });
    });
  });

  describe('buying property', () => {
    it('offers a pending purchase when landing on an unowned affordable property', () => {
      const state = engine.createInitialState(seats, {});
      mockDiceOnce(1, 2); // lands on square 3 (Birch Row, $60)
      const result = engine.rollDice(state, seats, 0);
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.pendingPurchase).toEqual({ spaceIndex: 3, price: 60 });
      // Turn stays with the buyer until they decide.
      expect(result.moveResult!.nextTurnSeat).toBe(0);
    });

    it('buying deducts cash, assigns ownership, and advances the turn', () => {
      const state = engine.createInitialState(seats, {});
      mockDiceOnce(1, 2);
      const rolled = engine.rollDice(state, seats, 0);
      const decision = engine.resolvePurchaseDecision(
        rolled.moveResult!.boardState,
        seats,
        0,
        true,
      );
      const after = decision.boardState as unknown as MonopolyState;
      expect(after.properties[3].ownerSeat).toBe(0);
      expect(after.players[0].cash).toBe(STARTING_CASH - 60);
      expect(decision.nextTurnSeat).toBe(1);
    });

    it('declining leaves the property unowned and still advances the turn', () => {
      const state = engine.createInitialState(seats, {});
      mockDiceOnce(1, 2);
      const rolled = engine.rollDice(state, seats, 0);
      const decision = engine.resolvePurchaseDecision(
        rolled.moveResult!.boardState,
        seats,
        0,
        false,
      );
      const after = decision.boardState as unknown as MonopolyState;
      expect(after.properties[3].ownerSeat).toBeNull();
      expect(after.players[0].cash).toBe(STARTING_CASH);
      expect(decision.nextTurnSeat).toBe(1);
    });
  });

  describe('rent', () => {
    it('charges rent to the bank-owned-by-opponent property owner', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[3].ownerSeat = 1;
      const expectedRent = BOARD[3].rent![0];
      mockDiceOnce(1, 2); // seat 0 lands on square 3, owned by seat 1
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].cash).toBe(STARTING_CASH - expectedRent);
      expect(after.players[1].cash).toBe(STARTING_CASH + expectedRent);
      expect(after.pendingPurchase).toBeNull();
    });
  });

  describe('tax', () => {
    it('deducts the tax amount when landing on a tax space', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].position = 1;
      mockDiceOnce(1, 2); // 1 + 3 = 4 (Income Tax, $200)
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].cash).toBe(STARTING_CASH - 200);
    });
  });

  describe('jail', () => {
    it('sends the player to jail when landing on Go To Jail', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].position = 27;
      mockDiceOnce(1, 2); // 27 + 3 = 30 (Go To Jail)
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].position).toBe(JAIL_SPACE_INDEX);
      expect(after.players[0].inJail).toBe(true);
    });

    it('keeps the player jailed on a non-double roll and passes the turn', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].inJail = true;
      mockDiceOnce(1, 2); // not doubles
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].inJail).toBe(true);
      expect(after.players[0].jailTurns).toBe(1);
      expect(result.moveResult!.nextTurnSeat).toBe(1);
    });

    it('releases the player on a double roll and moves them that amount', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].inJail = true;
      state.players[0].position = JAIL_SPACE_INDEX;
      mockDiceOnce(3, 3); // doubles -> escapes and moves 6
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].inJail).toBe(false);
      expect(after.players[0].position).toBe(JAIL_SPACE_INDEX + 6);
    });

    it('forces payment of the fine after the maximum jail turns', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].inJail = true;
      state.players[0].jailTurns = 2;
      state.players[0].position = JAIL_SPACE_INDEX;
      mockDiceOnce(1, 2); // 3rd non-double attempt -> forced out
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].inJail).toBe(false);
      expect(after.players[0].cash).toBe(STARTING_CASH - 50);
      expect(after.players[0].position).toBe(JAIL_SPACE_INDEX + 3);
    });

    it('pays the jail fine directly via payJailFine', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].inJail = true;
      const after = engine.payJailFine(
        state as unknown as Record<string, unknown>,
        0,
      ) as unknown as MonopolyState;
      expect(after.players[0].inJail).toBe(false);
      expect(after.players[0].cash).toBe(STARTING_CASH - 50);
    });

    it('rejects paying the fine when not in jail', () => {
      const state = engine.createInitialState(seats, {});
      expect(() =>
        engine.payJailFine(state as unknown as Record<string, unknown>, 0),
      ).toThrow('You are not in jail.');
    });
  });

  describe('bankruptcy', () => {
    it('bankrupts a player who cannot cover rent, returns their properties, and ends the game', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].position = 37;
      state.players[0].cash = 10;
      state.properties[39].ownerSeat = 1;
      const expectedRent = BOARD[39].rent![0];
      mockDiceOnce(1, 1); // doubles: 37 + 2 = 39 (Diamond Heights, owned by seat 1)
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].bankrupt).toBe(true);
      expect(after.players[0].cash).toBe(0);
      expect(after.players[1].cash).toBe(STARTING_CASH + expectedRent);
      expect(result.moveResult!.isGameOver).toBe(true);
      expect(result.moveResult!.winnerSeat).toBe(1);
    });
  });

  describe('buildHouse', () => {
    function stateWithFullGroupA(): MonopolyState {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0;
      state.properties[3].ownerSeat = 0;
      return state;
    }

    it('builds a house, deducting the house cost', () => {
      const state = stateWithFullGroupA();
      const after = engine.buildHouse(
        state as unknown as Record<string, unknown>,
        0,
        1,
      ) as unknown as MonopolyState;
      expect(after.properties[1].houses).toBe(1);
      expect(after.players[0].cash).toBe(STARTING_CASH - 50);
    });

    it('rejects building without owning the full color group', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0; // only owns square 1, not square 3
      expect(() =>
        engine.buildHouse(state as unknown as Record<string, unknown>, 0, 1),
      ).toThrow('You must own the full color group to build.');
    });

    it('enforces even building across the group', () => {
      const state = stateWithFullGroupA();
      const afterFirst = engine.buildHouse(
        state as unknown as Record<string, unknown>,
        0,
        1,
      );
      expect(() => engine.buildHouse(afterFirst, 0, 1)).toThrow(
        'Build evenly across the color group first.',
      );
    });
  });
});
