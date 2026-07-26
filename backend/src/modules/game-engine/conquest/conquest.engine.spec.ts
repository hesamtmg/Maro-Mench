import { ConquestEngine, ConquestState, CombatResult } from './conquest.engine';
import { RoomPlayerSeat } from '../game-engine.interface';
import { TERRITORIES, STARTING_ARMIES_BY_PLAYER_COUNT } from './board-config';

const CORAL_TERRITORY_IDS = TERRITORIES.filter((t) => t.continentId === 'coral').map(
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
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 4, pearl_isle: 2 });
      mockRolls(6, 5, /* attacker */ 2, 1 /* defender */);
      const { boardState, combat } = engine.attack(
        asRecord(s),
        0,
        'whitepeak',
        'pearl_isle',
        2,
      );
      const result = boardState as unknown as ConquestState;
      expect(combat.attackerLosses).toBe(0);
      expect(combat.defenderLosses).toBe(2);
      expect(combat.captured).toBe(true);
      expect(result.owner.pearl_isle).toBe(0);
    });

    it('defender wins ties: attacker loses', () => {
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 3, pearl_isle: 2 });
      mockRolls(4, /* attacker: 1 die */ 4 /* defender wins tie */);
      const { combat } = engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 1);
      expect(combat.attackerLosses).toBe(1);
      expect(combat.defenderLosses).toBe(0);
      expect(combat.captured).toBe(false);
    });

    it('moves in armies equal to the attacking dice count on capture', () => {
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 5, pearl_isle: 1 });
      mockRolls(6, 5, 3, /* attacker: 3 dice, all high */ 2 /* defender: 1 die, loses */);
      const { boardState, combat } = engine.attack(
        asRecord(s),
        0,
        'whitepeak',
        'pearl_isle',
        3,
      );
      const result = boardState as unknown as ConquestState;
      expect(combat.captured).toBe(true);
      expect(result.armies.pearl_isle).toBe(3);
      expect(result.armies.whitepeak).toBe(5 - 3);
    });

    it('eliminates a defender who loses their last territory', () => {
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 3, pearl_isle: 1 });
      mockRolls(6, 1);
      const { combat } = engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 1);
      expect(combat.eliminatedSeat).toBe(1);
    });

    it('declares a winner once only one seat remains active', () => {
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 3, pearl_isle: 1 });
      mockRolls(6, 1);
      const { combat } = engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 1);
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
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 1, pearl_isle: 1 });
      expect(() =>
        engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 1),
      ).toThrow('You need at least 2 armies to attack from there.');
    });

    it('caps attacker dice at armies-1 and at 3', () => {
      const s = baseState({ pearl_isle: 1 }, { whitepeak: 3, pearl_isle: 1 });
      expect(() =>
        engine.attack(asRecord(s), 0, 'whitepeak', 'pearl_isle', 3),
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
      // icemark -> coldharbor -> snowvale, all owned by seat 0.
      const s = baseState({}, { icemark: 5, snowvale: 1 }, { phase: 'fortify' });
      const move = engine.fortify(asRecord(s), 0, 'icemark', 'snowvale', 2);
      const result = move.boardState as unknown as ConquestState;
      expect(result.armies.snowvale).toBe(3);
    });

    it('rejects fortifying when both ends are owned but no owned path connects them', () => {
      // pearl_isle is seat 0's, but every one of its neighbors -- its only
      // links back to the mainland -- belongs to seat 1, isolating it.
      const s = baseState(
        { reefhaven: 1, saltmere: 1, whitepeak: 1 },
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
      // Seat 0 owns only Coral Archipelago (6 territories, +3 bonus);
      // seat 1 owns the other 36. Ending seat 1's turn hands seat 0 a
      // fresh reinforce phase, so its reinforcementsRemaining reflects
      // seat 0's bonus.
      const coralOwner = Object.fromEntries(CORAL_TERRITORY_IDS.map((id) => [id, 0]));
      const s = baseState(
        { ...Object.fromEntries(TERRITORIES.map((t) => [t.id, 1])), ...coralOwner },
        {},
        { phase: 'fortify', currentTurnSeat: 1 },
      );
      const move = engine.endTurn(asRecord(s), 1);
      const result = move.boardState as unknown as ConquestState;
      expect(result.currentTurnSeat).toBe(0);
      // Base: max(3, floor(6/3)) = 3, plus Coral Archipelago's +3 bonus.
      expect(result.reinforcementsRemaining).toBe(6);
    });

    it('does not award a bonus for a partially-held continent', () => {
      const coralOwner = Object.fromEntries(CORAL_TERRITORY_IDS.map((id) => [id, 0]));
      coralOwner[CORAL_TERRITORY_IDS[0]] = 1; // one Coral territory stays seat 1's
      const s = baseState(
        { ...Object.fromEntries(TERRITORIES.map((t) => [t.id, 1])), ...coralOwner },
        {},
        { phase: 'fortify', currentTurnSeat: 1 },
      );
      const move = engine.endTurn(asRecord(s), 1);
      const result = move.boardState as unknown as ConquestState;
      // Only 5 Coral territories owned, no continent completed -- just
      // the base max(3, floor(5/3)) = 3, no +3 on top.
      expect(result.reinforcementsRemaining).toBe(3);
    });
  });
});
