import { ConquestEngine, ConquestState, CombatResult } from './conquest.engine';
import { RoomPlayerSeat } from '../game-engine.interface';
import {
  CARD_BY_ID,
  STARTING_ARMIES_BY_PLAYER_COUNT,
  TERRITORIES,
  type CardDef,
} from './board-config';

function card(id: string): CardDef {
  const c = CARD_BY_ID[id];
  if (!c) throw new Error(`No such card fixture: ${id}`);
  return c;
}

const OCEANIA_TERRITORY_IDS = TERRITORIES.filter((t) => t.continentId === 'oceania').map(
  (t) => t.id,
);

function mockRolls(...faces: number[]) {
  const spy = jest.spyOn(Math, 'random');
  for (const face of faces) {
    spy.mockReturnValueOnce((face - 0.5) / 6);
  }
  return spy;
}

// All 42 territories owned by seat 0 with 1 army each by default -- tests
// override just the territories relevant to the scenario under test.
function baseState(
  ownerOverrides: Record<string, number> = {},
  armyOverrides: Record<string, number> = {},
  stateOverrides: Partial<ConquestState> = {},
): ConquestState {
  const owner: Record<string, number> = {};
  const armies: Record<string, number> = {};
  for (const t of TERRITORIES) {
    owner[t.id] = 0;
    armies[t.id] = 1;
  }
  Object.assign(owner, ownerOverrides);
  Object.assign(armies, armyOverrides);
  return {
    owner,
    armies,
    players: {
      0: { seatIndex: 0, eliminated: false },
      1: { seatIndex: 1, eliminated: false },
    },
    currentTurnSeat: 0,
    phase: 'attack',
    reinforcementsRemaining: 0,
    deck: [],
    discard: [],
    hands: { 0: [], 1: [] },
    cardsTradedInCount: 0,
    capturedTerritoryThisTurn: false,
    ...stateOverrides,
  };
}

function asRecord(state: ConquestState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>;
}

describe('ConquestEngine', () => {
  let engine: ConquestEngine;
  let seats: RoomPlayerSeat[];

  beforeEach(() => {
    engine = new ConquestEngine();
    seats = [
      { seatIndex: 0, userId: 'user-0' },
      { seatIndex: 1, userId: 'user-1' },
    ];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createInitialState', () => {
    it('assigns every territory to a seat with at least 1 army', () => {
      const state = engine.createInitialState(seats) as unknown as ConquestState;
      expect(Object.keys(state.owner)).toHaveLength(TERRITORIES.length);
      for (const t of TERRITORIES) {
        expect([0, 1]).toContain(state.owner[t.id]);
        expect(state.armies[t.id]).toBeGreaterThanOrEqual(1);
      }
    });

    it('deals out the full starting army pool for the player count', () => {
      const state = engine.createInitialState(seats) as unknown as ConquestState;
      const totalArmies = Object.values(state.armies).reduce((a, b) => a + b, 0);
      expect(totalArmies).toBe(STARTING_ARMIES_BY_PLAYER_COUNT[2] * 2);
    });

    it('starts on seat 0, reinforce phase, with the correct reinforcement count', () => {
      const state = engine.createInitialState(seats) as unknown as ConquestState;
      expect(state.currentTurnSeat).toBe(0);
      expect(state.phase).toBe('reinforce');
      const owned = Object.values(state.owner).filter((s) => s === 0).length;
      expect(state.reinforcementsRemaining).toBe(Math.max(3, Math.floor(owned / 3)));
    });

    it('deals a full shuffled 44-card deck and empty hands to start', () => {
      const state = engine.createInitialState(seats) as unknown as ConquestState;
      expect(state.deck).toHaveLength(TERRITORIES.length + 2);
      expect(state.discard).toEqual([]);
      expect(state.hands).toEqual({ 0: [], 1: [] });
      expect(state.cardsTradedInCount).toBe(0);
      expect(state.capturedTerritoryThisTurn).toBe(false);
    });

    it('splits territories across more than two seats too', () => {
      const fourSeats: RoomPlayerSeat[] = [
        { seatIndex: 0, userId: 'a' },
        { seatIndex: 1, userId: 'b' },
        { seatIndex: 2, userId: 'c' },
        { seatIndex: 3, userId: 'd' },
      ];
      const state = engine.createInitialState(fourSeats) as unknown as ConquestState;
      const owners = new Set(Object.values(state.owner));
      expect(owners).toEqual(new Set([0, 1, 2, 3]));
    });
  });

  describe('reinforce', () => {
    it('places armies on an owned territory and decrements the pool', () => {
      const state = baseState({}, {}, { phase: 'reinforce', reinforcementsRemaining: 5 });
      const result = engine.reinforce(
        asRecord(state),
        0,
        'icemark',
        3,
      ) as unknown as ConquestState;
      expect(result.armies.icemark).toBe(4);
      expect(result.reinforcementsRemaining).toBe(2);
      expect(result.phase).toBe('reinforce');
    });

    it('auto-advances to the attack phase once the pool is exhausted', () => {
      const state = baseState({}, {}, { phase: 'reinforce', reinforcementsRemaining: 3 });
      const result = engine.reinforce(
        asRecord(state),
        0,
        'icemark',
        3,
      ) as unknown as ConquestState;
      expect(result.reinforcementsRemaining).toBe(0);
      expect(result.phase).toBe('attack');
    });

    it('rejects placing on a territory you do not own', () => {
      const state = baseState(
        { icemark: 1 },
        {},
        { phase: 'reinforce', reinforcementsRemaining: 3 },
      );
      expect(() => engine.reinforce(asRecord(state), 0, 'icemark', 1)).toThrow(
        'You do not own that territory.',
      );
    });

    it('rejects placing more armies than remain in the pool', () => {
      const state = baseState({}, {}, { phase: 'reinforce', reinforcementsRemaining: 2 });
      expect(() => engine.reinforce(asRecord(state), 0, 'icemark', 3)).toThrow(
        'Not enough reinforcements left.',
      );
    });

    it('rejects reinforcing outside the reinforce phase', () => {
      const state = baseState({}, {}, { phase: 'attack' });
      expect(() => engine.reinforce(asRecord(state), 0, 'icemark', 1)).toThrow(
        'Not in the reinforce phase.',
      );
    });

    it("rejects acting when it isn't your turn", () => {
      const state = baseState(
        {},
        {},
        { phase: 'reinforce', reinforcementsRemaining: 3, currentTurnSeat: 1 },
      );
      expect(() => engine.reinforce(asRecord(state), 0, 'icemark', 1)).toThrow(
        'It is not your turn.',
      );
    });
  });

  describe('attack', () => {
    it('attacker wins both dice: defender loses 2 armies', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 4, sunset_bay: 2 });
      mockRolls(6, 5, /* attacker */ 2, 1 /* defender */);
      const { boardState, combat } = engine.attack(
        asRecord(s),
        0,
        'icemark',
        'sunset_bay',
        2,
      );
      const result = boardState as unknown as ConquestState;
      expect(combat.attackerLosses).toBe(0);
      expect(combat.defenderLosses).toBe(2);
      expect(combat.captured).toBe(true);
      expect(result.owner.sunset_bay).toBe(0);
    });

    it('defender wins ties: attacker loses', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 3, sunset_bay: 2 });
      mockRolls(4, /* attacker: 1 die */ 4 /* defender wins tie */);
      const { combat } = engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 1);
      expect(combat.attackerLosses).toBe(1);
      expect(combat.defenderLosses).toBe(0);
      expect(combat.captured).toBe(false);
    });

    it('moves in armies equal to the attacking dice count on capture', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 5, sunset_bay: 1 });
      mockRolls(6, 5, 3, /* attacker: 3 dice, all high */ 2 /* defender: 1 die, loses */);
      const { boardState, combat } = engine.attack(
        asRecord(s),
        0,
        'icemark',
        'sunset_bay',
        3,
      );
      const result = boardState as unknown as ConquestState;
      expect(combat.captured).toBe(true);
      expect(result.armies.sunset_bay).toBe(3);
      expect(result.armies.icemark).toBe(5 - 3);
    });

    it('eliminates a defender who loses their last territory', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 3, sunset_bay: 1 });
      mockRolls(6, 1);
      const { combat } = engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 1);
      expect(combat.eliminatedSeat).toBe(1);
    });

    it('declares a winner once only one seat remains active', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 3, sunset_bay: 1 });
      mockRolls(6, 1);
      const { combat } = engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 1);
      expect(combat.isGameOver).toBe(true);
      expect(combat.winnerSeat).toBe(0);
    });

    it('rejects attacking a non-adjacent territory', () => {
      const s = baseState({ pearl_isle: 1 }, { icemark: 3, pearl_isle: 1 });
      expect(() => engine.attack(asRecord(s), 0, 'icemark', 'pearl_isle', 1)).toThrow(
        'Those territories are not adjacent.',
      );
    });

    it('rejects attacking your own territory', () => {
      const s = baseState({}, { whitepeak: 3 });
      expect(() =>
        engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 1),
      ).toThrow('You already own that territory.');
    });

    it('rejects attacking with fewer than 2 armies at home', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 1, sunset_bay: 1 });
      expect(() =>
        engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 1),
      ).toThrow('You need at least 2 armies to attack from there.');
    });

    it('caps attacker dice at armies-1 and at 3', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 3, sunset_bay: 1 });
      expect(() =>
        engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 3),
      ).toThrow('You can attack with 1 to 2 dice here.');
    });

    it('rejects attacking outside the attack phase', () => {
      const s = baseState(
        { pearl_isle: 1 },
        { whitepeak: 3, pearl_isle: 1 },
        { phase: 'fortify' },
      );
      expect(() => engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 1)).toThrow(
        'Not in the attack phase.',
      );
    });
  });

  describe('endAttackPhase / fortify / endTurn', () => {
    it('moves from attack to fortify', () => {
      const s = baseState();
      const result = engine.endAttackPhase(asRecord(s), 0) as unknown as ConquestState;
      expect(result.phase).toBe('fortify');
    });

    it('fortifies between two owned territories connected through owned land', () => {
      const s = baseState(
        {},
        { icemark: 5, glacier_reach: 2 },
        { phase: 'fortify' },
      );
      const move = engine.fortify(asRecord(s), 0, 'icemark', 'glacier_reach', 3);
      const result = move.boardState as unknown as ConquestState;
      expect(result.armies.icemark).toBe(2);
      expect(result.armies.glacier_reach).toBe(5);
      // Fortifying ends the turn.
      expect(move.nextTurnSeat).toBe(1);
      expect(result.currentTurnSeat).toBe(1);
      expect(result.phase).toBe('reinforce');
    });

    it('allows fortifying through a multi-hop owned corridor', () => {
      // icemark -> tundrafall -> whitepeak -> snowvale, all owned by seat 0.
      const s = baseState({}, { icemark: 5, snowvale: 1 }, { phase: 'fortify' });
      const move = engine.fortify(asRecord(s), 0, 'icemark', 'snowvale', 2);
      const result = move.boardState as unknown as ConquestState;
      expect(result.armies.snowvale).toBe(3);
    });

    it('rejects fortifying when both ends are owned but no owned path connects them', () => {
      // pearl_isle is seat 0's, but its only neighbor (its sole link back
      // to the mainland) belongs to seat 1, isolating it.
      const s = baseState(
        { reefhaven: 1, whitepeak: 1 },
        { icemark: 5 },
        { phase: 'fortify' },
      );
      expect(() =>
        engine.fortify(asRecord(s), 0, 'icemark', 'pearl_isle', 1),
      ).toThrow('Those territories are not connected through land you own.');
    });

    it('rejects fortifying more armies than available (must leave 1 behind)', () => {
      const s = baseState({}, { icemark: 3, glacier_reach: 1 }, { phase: 'fortify' });
      expect(() =>
        engine.fortify(asRecord(s), 0, 'icemark', 'glacier_reach', 3),
      ).toThrow('Must leave at least one army behind.');
    });

    it('endTurn advances to the next seat and resets to the reinforce phase', () => {
      const s = baseState({}, {}, { phase: 'fortify' });
      const move = engine.endTurn(asRecord(s), 0);
      const result = move.boardState as unknown as ConquestState;
      expect(move.nextTurnSeat).toBe(1);
      expect(result.currentTurnSeat).toBe(1);
      expect(result.phase).toBe('reinforce');
    });

    it('endTurn refuses to skip an unfinished reinforce phase', () => {
      const s = baseState({}, {}, { phase: 'reinforce', reinforcementsRemaining: 2 });
      expect(() => engine.endTurn(asRecord(s), 0)).toThrow(
        'Place all reinforcements before ending your turn.',
      );
    });

    it('skips an eliminated seat when advancing turns', () => {
      const s = baseState(
        {},
        {},
        {
          phase: 'fortify',
          players: {
            0: { seatIndex: 0, eliminated: false },
            1: { seatIndex: 1, eliminated: true },
            2: { seatIndex: 2, eliminated: false },
          },
        },
      );
      const move = engine.endTurn(asRecord(s), 0);
      const result = move.boardState as unknown as ConquestState;
      expect(result.currentTurnSeat).toBe(2);
    });
  });

  describe('forceEndTurn (turn-timeout stall protection)', () => {
    it('auto-places leftover reinforcements on the strongest territory, then ends the turn', () => {
      const s = baseState(
        {},
        { icemark: 1, glacier_reach: 5 },
        { phase: 'reinforce', reinforcementsRemaining: 4 },
      );
      const move = engine.forceEndTurn(asRecord(s));
      const result = move.boardState as unknown as ConquestState;
      expect(result.armies.glacier_reach).toBe(9);
      expect(move.nextTurnSeat).toBe(1);
      expect(result.currentTurnSeat).toBe(1);
      expect(result.phase).toBe('reinforce');
      // reinforcementsRemaining now reflects seat 1's fresh pool for their
      // turn (the minimum of 3, since this fixture gives them 0
      // territories), not "leftover cleared to 0" -- the field gets
      // recomputed by advanceTurn() for whoever's turn it becomes next.
      expect(result.reinforcementsRemaining).toBe(3);
    });

    it('just ends the turn when there is nothing left to reinforce', () => {
      const s = baseState({}, {}, { phase: 'attack' });
      const move = engine.forceEndTurn(asRecord(s));
      const result = move.boardState as unknown as ConquestState;
      expect(result.currentTurnSeat).toBe(1);
      expect(result.phase).toBe('reinforce');
    });
  });

  describe('continent bonus', () => {
    it('adds the continent bonus once a seat owns every territory in it', () => {
      // Seat 0 owns only Oceania (4 territories, +2 bonus); seat 1 owns
      // the other 38. Ending seat 1's turn hands seat 0 a fresh reinforce
      // phase, so its reinforcementsRemaining reflects seat 0's bonus.
      const oceaniaOwner = Object.fromEntries(OCEANIA_TERRITORY_IDS.map((id) => [id, 0]));
      const s = baseState(
        { ...Object.fromEntries(TERRITORIES.map((t) => [t.id, 1])), ...oceaniaOwner },
        {},
        { phase: 'fortify', currentTurnSeat: 1 },
      );
      const move = engine.endTurn(asRecord(s), 1);
      const result = move.boardState as unknown as ConquestState;
      expect(result.currentTurnSeat).toBe(0);
      // Base: max(3, floor(4/3)) = 3, plus Oceania's +2 bonus.
      expect(result.reinforcementsRemaining).toBe(5);
    });

    it('does not award a bonus for a partially-held continent', () => {
      const oceaniaOwner = Object.fromEntries(OCEANIA_TERRITORY_IDS.map((id) => [id, 0]));
      oceaniaOwner[OCEANIA_TERRITORY_IDS[0]] = 1; // one Oceania territory stays seat 1's
      const s = baseState(
        { ...Object.fromEntries(TERRITORIES.map((t) => [t.id, 1])), ...oceaniaOwner },
        {},
        { phase: 'fortify', currentTurnSeat: 1 },
      );
      const move = engine.endTurn(asRecord(s), 1);
      const result = move.boardState as unknown as ConquestState;
      // Only 3 of 4 Oceania territories owned, no continent completed --
      // just the base max(3, floor(3/3)) = 3, no +2 on top.
      expect(result.reinforcementsRemaining).toBe(3);
    });
  });

  describe('cards', () => {
    it('flags capturedTerritoryThisTurn when an attack captures a territory', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 4, sunset_bay: 2 });
      mockRolls(6, 5, 2, 1);
      const { boardState } = engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 2);
      const result = boardState as unknown as ConquestState;
      expect(result.capturedTerritoryThisTurn).toBe(true);
    });

    it('does not flag capturedTerritoryThisTurn on a failed attack', () => {
      const s = baseState({ sunset_bay: 1 }, { icemark: 3, sunset_bay: 2 });
      mockRolls(4, 4);
      const { boardState } = engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 1);
      const result = boardState as unknown as ConquestState;
      expect(result.capturedTerritoryThisTurn).toBe(false);
    });

    it('draws a card when ending a turn that captured a territory', () => {
      const drawn = card('card_icemark');
      const s = baseState(
        {},
        {},
        { phase: 'fortify', capturedTerritoryThisTurn: true, deck: [drawn] },
      );
      const move = engine.endTurn(asRecord(s), 0);
      const result = move.boardState as unknown as ConquestState;
      expect(result.hands[0]).toEqual([drawn]);
      expect(result.deck).toEqual([]);
      expect(result.capturedTerritoryThisTurn).toBe(false);
      expect(move.movePayload.drewCard).toEqual(drawn);
    });

    it('does not draw a card when ending a turn with no capture', () => {
      const s = baseState(
        {},
        {},
        { phase: 'fortify', capturedTerritoryThisTurn: false, deck: [card('card_icemark')] },
      );
      const move = engine.endTurn(asRecord(s), 0);
      const result = move.boardState as unknown as ConquestState;
      expect(result.hands[0]).toEqual([]);
      expect(result.deck).toHaveLength(1);
      expect(move.movePayload.drewCard).toBeNull();
    });

    it('reshuffles the discard pile back into the deck once it runs dry', () => {
      const discardedCards = [card('card_icemark'), card('card_glacier_reach')];
      const s = baseState(
        {},
        {},
        { phase: 'fortify', capturedTerritoryThisTurn: true, deck: [], discard: discardedCards },
      );
      const move = engine.endTurn(asRecord(s), 0);
      const result = move.boardState as unknown as ConquestState;
      expect(result.hands[0]).toHaveLength(1);
      expect(result.discard).toEqual([]);
      // One of the two reshuffled cards was drawn, leaving the other in the deck.
      expect(result.deck).toHaveLength(1);
      expect([...result.hands[0], ...result.deck].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [...discardedCards].sort((a, b) => a.id.localeCompare(b.id)),
      );
    });

    it('hands the eliminated seat their cards over to the eliminator', () => {
      const eliminatedHand = [card('card_snowvale'), card('card_whitepeak')];
      const s = baseState(
        { sunset_bay: 1 },
        { icemark: 3, sunset_bay: 1 },
        { hands: { 0: [card('card_icemark')], 1: eliminatedHand } },
      );
      mockRolls(6, 1);
      const { boardState } = engine.attack(asRecord(s), 0, 'icemark', 'sunset_bay', 1);
      const result = boardState as unknown as ConquestState;
      expect(result.hands[1]).toEqual([]);
      expect(result.hands[0]).toEqual([card('card_icemark'), ...eliminatedHand]);
    });

    it('rejects placing reinforcements once a seat holds 5 or more cards', () => {
      const hand = [
        card('card_icemark'),
        card('card_glacier_reach'),
        card('card_frozen_cape'),
        card('card_tundrafall'),
        card('card_whitepeak'),
      ];
      const s = baseState(
        {},
        {},
        { phase: 'reinforce', reinforcementsRemaining: 3, hands: { 0: hand, 1: [] } },
      );
      expect(() => engine.reinforce(asRecord(s), 0, 'icemark', 1)).toThrow(
        'You have 5 or more cards -- trade in a set before placing reinforcements.',
      );
    });

    describe('tradeInCards', () => {
      function stateWithHand(hand: CardDef[], overrides: Partial<ConquestState> = {}) {
        return baseState(
          {},
          {},
          { phase: 'reinforce', reinforcementsRemaining: 2, hands: { 0: hand, 1: [] }, ...overrides },
        );
      }

      it('trades a three-of-a-kind set for the first-trade-in bonus', () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_snowvale')];
        const s = stateWithHand(hand);
        const { boardState, bonus } = engine.tradeInCards(
          asRecord(s),
          0,
          hand.map((c) => c.id),
        );
        const result = boardState as unknown as ConquestState;
        expect(bonus).toBe(4);
        expect(result.reinforcementsRemaining).toBe(2 + 4);
        expect(result.cardsTradedInCount).toBe(1);
        expect(result.hands[0]).toEqual([]);
        expect(result.discard).toEqual(expect.arrayContaining(hand));
      });

      it('trades a one-of-each set', () => {
        const hand = [card('card_icemark'), card('card_glacier_reach'), card('card_frozen_cape')];
        const s = stateWithHand(hand);
        const { bonus } = engine.tradeInCards(
          asRecord(s),
          0,
          hand.map((c) => c.id),
        );
        expect(bonus).toBe(4);
      });

      it('accepts a set filled out with a wildcard', () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_wild_1')];
        const s = stateWithHand(hand);
        const { bonus } = engine.tradeInCards(
          asRecord(s),
          0,
          hand.map((c) => c.id),
        );
        expect(bonus).toBe(4);
      });

      it('rejects a mismatched set (two of one symbol, one of another)', () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_glacier_reach')];
        const s = stateWithHand(hand);
        expect(() =>
          engine.tradeInCards(
            asRecord(s),
            0,
            hand.map((c) => c.id),
          ),
        ).toThrow('Those cards are not a valid set');
      });

      it('rejects trading in cards not held', () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_coldharbor')];
        const s = stateWithHand(hand);
        expect(() =>
          engine.tradeInCards(asRecord(s), 0, ['card_icemark', 'card_tundrafall', 'card_snowvale']),
        ).toThrow('You do not hold one of those cards.');
      });

      it('rejects a count other than 3', () => {
        const hand = [card('card_icemark'), card('card_tundrafall')];
        const s = stateWithHand(hand);
        expect(() =>
          engine.tradeInCards(
            asRecord(s),
            0,
            hand.map((c) => c.id),
          ),
        ).toThrow('Trade in exactly 3 cards.');
      });

      it('rejects trading outside the reinforce phase', () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_coldharbor')];
        const s = stateWithHand(hand, { phase: 'attack' });
        expect(() =>
          engine.tradeInCards(
            asRecord(s),
            0,
            hand.map((c) => c.id),
          ),
        ).toThrow('You can only trade in cards during the reinforce phase.');
      });

      it("rejects acting when it isn't your turn", () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_coldharbor')];
        const s = stateWithHand(hand, { currentTurnSeat: 1 });
        expect(() =>
          engine.tradeInCards(
            asRecord(s),
            0,
            hand.map((c) => c.id),
          ),
        ).toThrow('It is not your turn.');
      });

      it('escalates the bonus based on how many sets have already been traded', () => {
        const hand = [card('card_icemark'), card('card_tundrafall'), card('card_snowvale')];
        const s = stateWithHand(hand, { cardsTradedInCount: 5 });
        const { bonus } = engine.tradeInCards(
          asRecord(s),
          0,
          hand.map((c) => c.id),
        );
        // TRADE_IN_BASE_BONUSES = [4,6,8,10,12,15] -- index 5 is the last
        // scripted value (15); the 7th trade-in (index 6) would be 20.
        expect(bonus).toBe(15);
      });

      it('awards +2 armies directly on a traded territory the seat still owns', () => {
        const hand = [card('card_icemark'), card('card_glacier_reach'), card('card_frozen_cape')];
        const s = stateWithHand(hand, { armies: { ...baseState().armies, icemark: 3 } });
        const { boardState, territoryBonusId } = engine.tradeInCards(
          asRecord(s),
          0,
          hand.map((c) => c.id),
        );
        const result = boardState as unknown as ConquestState;
        expect(territoryBonusId).toBe('icemark');
        expect(result.armies.icemark).toBe(3 + 2);
      });

      it('awards no territory bonus when none of the traded territories are owned', () => {
        const hand = [card('card_icemark'), card('card_glacier_reach'), card('card_frozen_cape')];
        const s = stateWithHand(hand, {
          owner: { ...baseState().owner, icemark: 1, glacier_reach: 1, frozen_cape: 1 },
        });
        const { territoryBonusId } = engine.tradeInCards(
          asRecord(s),
          0,
          hand.map((c) => c.id),
        );
        expect(territoryBonusId).toBeNull();
      });
    });
  });
});
