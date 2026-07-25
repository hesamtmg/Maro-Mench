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

    it('declining leaves the property unowned and starts an auction instead of ending the turn', () => {
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
      // Turn doesn't advance until the auction resolves.
      expect(decision.nextTurnSeat).toBe(0);
      expect(after.auction).toEqual({
        spaceIndex: 3,
        highestBid: 0,
        highestBidderSeat: null,
        activeBidders: [0, 1],
        currentBidderSeat: 1,
        originSeat: 0,
      });
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

  describe('mortgaging', () => {
    it('mortgages a house-free property for half its price', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0; // Elm Row, $60
      const after = engine.mortgageProperty(
        state as unknown as Record<string, unknown>,
        0,
        1,
      ) as unknown as MonopolyState;
      expect(after.properties[1].mortgaged).toBe(true);
      expect(after.players[0].cash).toBe(STARTING_CASH + 30);
    });

    it('rejects mortgaging a property with houses on it', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0;
      state.properties[1].houses = 1;
      expect(() =>
        engine.mortgageProperty(state as unknown as Record<string, unknown>, 0, 1),
      ).toThrow('Sell the houses on this property before mortgaging it.');
    });

    it('rejects mortgaging a property you do not own', () => {
      const state = engine.createInitialState(seats, {});
      expect(() =>
        engine.mortgageProperty(state as unknown as Record<string, unknown>, 0, 1),
      ).toThrow('You do not own this property.');
    });

    it('unmortgages a property for the mortgage value plus 10% interest', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0;
      state.properties[1].mortgaged = true;
      const after = engine.unmortgageProperty(
        state as unknown as Record<string, unknown>,
        0,
        1,
      ) as unknown as MonopolyState;
      expect(after.properties[1].mortgaged).toBe(false);
      // mortgageValue = 30, +10% interest (rounded up) = 3 -> 33 total.
      expect(after.players[0].cash).toBe(STARTING_CASH - 33);
    });

    it('rejects unmortgaging without enough cash', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0;
      state.properties[1].mortgaged = true;
      state.players[0].cash = 10;
      expect(() =>
        engine.unmortgageProperty(state as unknown as Record<string, unknown>, 0, 1),
      ).toThrow('Not enough cash to unmortgage.');
    });

    it('charges no rent on a mortgaged property', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[3].ownerSeat = 1;
      state.properties[3].mortgaged = true;
      mockDiceOnce(1, 2); // seat 0 lands on square 3
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.players[0].cash).toBe(STARTING_CASH);
      expect(after.players[1].cash).toBe(STARTING_CASH);
    });
  });

  describe('selling houses', () => {
    function stateWithHousesOnGroupA(houses1: number, houses3: number): MonopolyState {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0;
      state.properties[3].ownerSeat = 0;
      state.properties[1].houses = houses1;
      state.properties[3].houses = houses3;
      return state;
    }

    it('sells a house for half its cost', () => {
      const state = stateWithHousesOnGroupA(1, 1);
      const after = engine.sellHouse(
        state as unknown as Record<string, unknown>,
        0,
        1,
      ) as unknown as MonopolyState;
      expect(after.properties[1].houses).toBe(0);
      expect(after.players[0].cash).toBe(STARTING_CASH + 25); // houseCost 50 / 2
    });

    it('rejects selling from a property with nothing built', () => {
      const state = stateWithHousesOnGroupA(0, 1);
      expect(() =>
        engine.sellHouse(state as unknown as Record<string, unknown>, 0, 1),
      ).toThrow('There is nothing built here to sell.');
    });

    it('enforces even selling across the group', () => {
      const state = stateWithHousesOnGroupA(1, 2);
      expect(() =>
        engine.sellHouse(state as unknown as Record<string, unknown>, 0, 1),
      ).toThrow('Sell evenly across the color group first.');
      // Selling from the property with the most houses is fine.
      const after = engine.sellHouse(
        state as unknown as Record<string, unknown>,
        0,
        3,
      ) as unknown as MonopolyState;
      expect(after.properties[3].houses).toBe(1);
    });
  });

  describe('auctions', () => {
    it('starts an auction directly when the landing player cannot afford the property', () => {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.players[0].cash = 10; // can't afford square 3 ($60)
      mockDiceOnce(1, 2);
      const result = engine.rollDice(
        state as unknown as Record<string, unknown>,
        seats,
        0,
      );
      const after = result.moveResult!.boardState as unknown as MonopolyState;
      expect(after.pendingPurchase).toBeNull();
      expect(after.auction).toMatchObject({
        spaceIndex: 3,
        activeBidders: [0, 1],
        currentBidderSeat: 1,
        originSeat: 0,
      });
      expect(result.moveResult!.nextTurnSeat).toBe(0);
    });

    function stateWithAuction(): MonopolyState {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.auction = {
        spaceIndex: 3,
        highestBid: 0,
        highestBidderSeat: null,
        activeBidders: [0, 1],
        currentBidderSeat: 1,
        originSeat: 0,
      };
      return state;
    }

    it('rejects a bid out of turn', () => {
      const state = stateWithAuction();
      expect(() =>
        engine.placeBid(state as unknown as Record<string, unknown>, 0, 10),
      ).toThrow('It is not your turn to bid.');
    });

    it('rejects a bid that does not exceed the current highest', () => {
      const state = stateWithAuction();
      state.auction!.highestBid = 20;
      expect(() =>
        engine.placeBid(state as unknown as Record<string, unknown>, 1, 20),
      ).toThrow('Bid must be higher than the current highest bid.');
    });

    it('rejects a bid exceeding the bidder\'s cash', () => {
      const state = stateWithAuction();
      state.players[1].cash = 5;
      expect(() =>
        engine.placeBid(state as unknown as Record<string, unknown>, 1, 10),
      ).toThrow('You cannot bid more than your cash.');
    });

    it('records a valid bid and advances to the next bidder', () => {
      const state = stateWithAuction();
      const after = engine.placeBid(
        state as unknown as Record<string, unknown>,
        1,
        30,
      ) as unknown as MonopolyState;
      expect(after.auction).toMatchObject({
        highestBid: 30,
        highestBidderSeat: 1,
        currentBidderSeat: 0,
      });
    });

    it('rejects passing while holding the highest bid', () => {
      const state = stateWithAuction();
      state.auction!.highestBid = 30;
      state.auction!.highestBidderSeat = 1;
      state.auction!.currentBidderSeat = 1;
      expect(() =>
        engine.passAuction(state as unknown as Record<string, unknown>, seats, 1),
      ).toThrow('You cannot pass while holding the highest bid.');
    });

    it('resolves the auction and resumes the main turn when one bidder remains after a pass', () => {
      let state = stateWithAuction();
      let boardState = engine.placeBid(
        state as unknown as Record<string, unknown>,
        1,
        30,
      );
      const passResult = engine.passAuction(boardState, seats, 0);
      expect(passResult.resolved).toBe(true);
      const after = passResult.moveResult!.boardState as unknown as MonopolyState;
      expect(after.properties[3].ownerSeat).toBe(1);
      expect(after.players[1].cash).toBe(STARTING_CASH - 30);
      expect(after.auction).toBeNull();
      // Main turn resumes from originSeat (0), not the auction winner.
      expect(passResult.moveResult!.nextTurnSeat).toBe(1);
    });

    it('leaves the property unsold if every bidder passes without ever bidding', () => {
      const state = stateWithAuction();
      const passResult = engine.passAuction(
        state as unknown as Record<string, unknown>,
        seats,
        1,
      );
      expect(passResult.resolved).toBe(true);
      const after = passResult.moveResult!.boardState as unknown as MonopolyState;
      expect(after.properties[3].ownerSeat).toBeNull();
      expect(after.auction).toBeNull();
    });
  });

  describe('trading', () => {
    function stateWithOwnedProperties(): MonopolyState {
      const state = engine.createInitialState(seats, {}) as unknown as MonopolyState;
      state.properties[1].ownerSeat = 0; // Elm Row, seat 0
      state.properties[6].ownerSeat = 1; // Harbor Lane, seat 1
      return state;
    }

    it('rejects offering a property you do not own', () => {
      const state = stateWithOwnedProperties();
      expect(() =>
        engine.proposeTrade(state as unknown as Record<string, unknown>, 0, 1, {
          offerCash: 0,
          offerProperties: [6],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [],
          requestJailCards: 0,
        }),
      ).toThrow(/does not own/);
    });

    it('rejects offering a property with houses on it', () => {
      const state = stateWithOwnedProperties();
      state.properties[1].houses = 1;
      expect(() =>
        engine.proposeTrade(state as unknown as Record<string, unknown>, 0, 1, {
          offerCash: 0,
          offerProperties: [1],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [],
          requestJailCards: 0,
        }),
      ).toThrow(/houses on it/);
    });

    it('creates a pending trade offer', () => {
      const state = stateWithOwnedProperties();
      const after = engine.proposeTrade(
        state as unknown as Record<string, unknown>,
        0,
        1,
        {
          offerCash: 50,
          offerProperties: [1],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [6],
          requestJailCards: 0,
        },
      ) as unknown as MonopolyState;
      expect(after.trades).toHaveLength(1);
      expect(after.trades[0]).toMatchObject({
        fromSeat: 0,
        toSeat: 1,
        offerCash: 50,
        offerProperties: [1],
        requestProperties: [6],
      });
    });

    it('accepting a trade swaps cash and properties both ways', () => {
      const state = stateWithOwnedProperties();
      const proposed = engine.proposeTrade(
        state as unknown as Record<string, unknown>,
        0,
        1,
        {
          offerCash: 50,
          offerProperties: [1],
          offerJailCards: 0,
          requestCash: 20,
          requestProperties: [6],
          requestJailCards: 0,
        },
      ) as unknown as MonopolyState;
      const tradeId = proposed.trades[0].id;

      const after = engine.respondToTrade(
        proposed as unknown as Record<string, unknown>,
        1,
        tradeId,
        true,
      ) as unknown as MonopolyState;

      expect(after.trades).toHaveLength(0);
      expect(after.properties[1].ownerSeat).toBe(1);
      expect(after.properties[6].ownerSeat).toBe(0);
      // Seat 0 pays 50, receives 20 back -> net -30.
      expect(after.players[0].cash).toBe(STARTING_CASH - 30);
      expect(after.players[1].cash).toBe(STARTING_CASH + 30);
    });

    it('declining a trade just removes the offer with no state change', () => {
      const state = stateWithOwnedProperties();
      const proposed = engine.proposeTrade(
        state as unknown as Record<string, unknown>,
        0,
        1,
        {
          offerCash: 50,
          offerProperties: [1],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [6],
          requestJailCards: 0,
        },
      ) as unknown as MonopolyState;
      const tradeId = proposed.trades[0].id;

      const after = engine.respondToTrade(
        proposed as unknown as Record<string, unknown>,
        1,
        tradeId,
        false,
      ) as unknown as MonopolyState;

      expect(after.trades).toHaveLength(0);
      expect(after.properties[1].ownerSeat).toBe(0);
      expect(after.players[0].cash).toBe(STARTING_CASH);
    });

    it('only the recipient can accept; the proposer can still cancel', () => {
      const state = stateWithOwnedProperties();
      const proposed = engine.proposeTrade(
        state as unknown as Record<string, unknown>,
        0,
        1,
        {
          offerCash: 0,
          offerProperties: [1],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [6],
          requestJailCards: 0,
        },
      ) as unknown as MonopolyState;
      const tradeId = proposed.trades[0].id;

      expect(() =>
        engine.respondToTrade(proposed as unknown as Record<string, unknown>, 0, tradeId, true),
      ).toThrow('Only the recipient can accept a trade.');

      const cancelled = engine.respondToTrade(
        proposed as unknown as Record<string, unknown>,
        0,
        tradeId,
        false,
      ) as unknown as MonopolyState;
      expect(cancelled.trades).toHaveLength(0);
    });

    it('re-validates ownership at accept time and rejects a stale offer', () => {
      const state = stateWithOwnedProperties();
      const proposed = engine.proposeTrade(
        state as unknown as Record<string, unknown>,
        0,
        1,
        {
          offerCash: 0,
          offerProperties: [1],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [6],
          requestJailCards: 0,
        },
      ) as unknown as MonopolyState;
      const tradeId = proposed.trades[0].id;

      // Seat 0 sells square 1 to the bank (simulating bankruptcy) before
      // seat 1 gets a chance to accept.
      proposed.properties[1].ownerSeat = null;

      expect(() =>
        engine.respondToTrade(
          proposed as unknown as Record<string, unknown>,
          1,
          tradeId,
          true,
        ),
      ).toThrow(/does not own/);
    });
  });
});
