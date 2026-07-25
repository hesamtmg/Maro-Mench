import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MonopolyBoard from '../MonopolyBoard.vue';
import { BOARD } from '../monopoly/board-config';
import type { RoomPlayer } from '../../types';

function makePlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    userId: 'user-1',
    displayName: 'Alice',
    seatIndex: 0,
    color: '#e33e3e',
    status: 'joined',
    isAdmin: false,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

// A 4-seat lineup, since the whole point of this suite is checking the
// board holds up with more than the 2-player case every other test in
// the app happens to use.
const FOUR_PLAYERS: RoomPlayer[] = [
  makePlayer({ userId: 'u0', displayName: 'Alice', seatIndex: 0, color: '#e33e3e' }),
  makePlayer({ userId: 'u1', displayName: 'Bob', seatIndex: 1, color: '#3f6fd1' }),
  makePlayer({ userId: 'u2', displayName: 'Carol', seatIndex: 2, color: '#3aa15c' }),
  makePlayer({ userId: 'u3', displayName: 'Dan', seatIndex: 3, color: '#e8b93e' }),
];

function baseState(overrides: Partial<Record<string, unknown>> = {}) {
  const players: Record<number, unknown> = {};
  for (let i = 0; i < 4; i++) {
    players[i] = {
      cash: 1500,
      position: 0,
      inJail: false,
      bankrupt: false,
      jailFreeCards: 0,
    };
  }
  const properties: Record<number, unknown> = {};
  for (const space of BOARD) {
    if (space.type === 'property' || space.type === 'transit' || space.type === 'utility') {
      properties[space.index] = { ownerSeat: null, houses: 0, mortgaged: false };
    }
  }
  return {
    players,
    properties,
    pendingPurchase: null,
    auction: null,
    pendingDebt: null,
    trades: [],
    ...overrides,
  };
}

function mountBoard(stateOverrides: Record<string, unknown> = {}, propOverrides: Record<string, unknown> = {}) {
  return mount(MonopolyBoard, {
    props: {
      boardState: baseState(stateOverrides) as unknown as Record<string, unknown>,
      players: FOUR_PLAYERS,
      currentTurnSeat: 0,
      mySeatIndex: 0,
      ...propOverrides,
    },
  });
}

describe('MonopolyBoard', () => {
  it('renders all 40 spaces', () => {
    const wrapper = mountBoard();
    expect(wrapper.findAll('.ms-cell')).toHaveLength(40);
  });

  it('lists every player in the summary panel with their cash', () => {
    const wrapper = mountBoard({
      players: {
        0: { cash: 1500, position: 0, inJail: false, bankrupt: false, jailFreeCards: 0 },
        1: { cash: 1340, position: 5, inJail: false, bankrupt: false, jailFreeCards: 0 },
        2: { cash: 900, position: 12, inJail: false, bankrupt: false, jailFreeCards: 0 },
        3: { cash: 60, position: 27, inJail: false, bankrupt: false, jailFreeCards: 0 },
      },
    });
    const rows = wrapper.findAll('.ms-player-row');
    expect(rows).toHaveLength(4);
    expect(rows[3].text()).toContain('Dan');
    expect(rows[3].text()).toContain('60');
  });

  it('highlights only the current turn player among four', () => {
    const wrapper = mountBoard({}, { currentTurnSeat: 2 });
    const rows = wrapper.findAll('.ms-player-row');
    expect(rows[0].classes()).not.toContain('ms-player-active');
    expect(rows[2].classes()).toContain('ms-player-active');
    expect(rows[1].classes()).not.toContain('ms-player-active');
    expect(rows[3].classes()).not.toContain('ms-player-active');
  });

  it('marks a bankrupt player distinctly in the summary', () => {
    const wrapper = mountBoard({
      players: {
        0: { cash: 1500, position: 0, inJail: false, bankrupt: false, jailFreeCards: 0 },
        1: { cash: 0, position: 5, inJail: false, bankrupt: true, jailFreeCards: 0 },
        2: { cash: 900, position: 12, inJail: false, bankrupt: false, jailFreeCards: 0 },
        3: { cash: 60, position: 27, inJail: true, bankrupt: false, jailFreeCards: 0 },
      },
    });
    const rows = wrapper.findAll('.ms-player-row');
    expect(rows[1].text()).toContain('💸');
    expect(rows[3].text()).toContain('🚔');
    expect(rows[0].text()).not.toContain('💸');
  });

  it('renders one token per player, on their own space, when all four are scattered', () => {
    const wrapper = mountBoard({
      players: {
        0: { cash: 1500, position: 3, inJail: false, bankrupt: false, jailFreeCards: 0 },
        1: { cash: 1500, position: 11, inJail: false, bankrupt: false, jailFreeCards: 0 },
        2: { cash: 1500, position: 24, inJail: false, bankrupt: false, jailFreeCards: 0 },
        3: { cash: 1500, position: 33, inJail: false, bankrupt: false, jailFreeCards: 0 },
      },
    });
    expect(wrapper.findAll('.ms-token')).toHaveLength(4);
  });

  it('stacks multiple tokens on the same space (e.g. all still on Go)', () => {
    const wrapper = mountBoard(); // baseState puts all 4 players at position 0
    const goCell = wrapper.findAll('.ms-cell')[0];
    expect(goCell.findAll('.ms-token')).toHaveLength(4);
  });

  it('excludes a bankrupt player\'s token from the board', () => {
    const wrapper = mountBoard({
      players: {
        0: { cash: 1500, position: 5, inJail: false, bankrupt: false, jailFreeCards: 0 },
        1: { cash: 0, position: 5, inJail: false, bankrupt: true, jailFreeCards: 0 },
        2: { cash: 1500, position: 5, inJail: false, bankrupt: false, jailFreeCards: 0 },
        3: { cash: 1500, position: 5, inJail: false, bankrupt: false, jailFreeCards: 0 },
      },
    });
    const cell = wrapper.findAll('.ms-cell')[5];
    expect(cell.findAll('.ms-token')).toHaveLength(3);
  });

  it("shows an owner dot with the owner's token on an owned property", () => {
    const wrapper = mountBoard({
      properties: {
        ...baseState().properties,
        1: { ownerSeat: 2, houses: 0, mortgaged: false },
      },
    });
    const cell = wrapper.findAll('.ms-cell')[1]; // Molavi is board index 1
    const dot = cell.find('.ms-owner-dot');
    expect(dot.exists()).toBe(true);
    expect(dot.find('img').exists()).toBe(true);
  });

  it('shows a house count and a hotel icon distinctly in the center Buildings list', () => {
    const wrapper = mountBoard({
      properties: {
        ...baseState().properties,
        1: { ownerSeat: 0, houses: 3, mortgaged: false },
        3: { ownerSeat: 0, houses: 5, mortgaged: false },
      },
    });
    const items = wrapper.findAll('.ms-buildings .ms-owned-item');
    expect(items).toHaveLength(2);
    expect(items[0].findAll('.ms-building:not(.ms-building-hotel)')).toHaveLength(3);
    expect(items[0].findAll('.ms-building-hotel')).toHaveLength(0);
    expect(items[1].findAll('.ms-building-hotel')).toHaveLength(1);
    expect(items[1].findAll('.ms-building:not(.ms-building-hotel)')).toHaveLength(0);
  });

  it('marks a mortgaged property with the dimmed class and an "M" badge', () => {
    const wrapper = mountBoard({
      properties: {
        ...baseState().properties,
        1: { ownerSeat: 0, houses: 0, mortgaged: true },
      },
    });
    const cell = wrapper.findAll('.ms-cell')[1];
    expect(cell.classes()).toContain('ms-mortgaged');
    expect(cell.find('.ms-mortgaged-badge').exists()).toBe(true);
  });

  describe('purchase decisions with four players', () => {
    it("shows buy/pass controls only to the current player, not the other three", () => {
      const pending = { spaceIndex: 3, price: 60 };
      const mine = mountBoard({ pendingPurchase: pending }, { currentTurnSeat: 0, mySeatIndex: 0 });
      expect(mine.findAll('.ms-action button').some((b) => b.text() === 'Buy')).toBe(true);

      const someoneElses = mountBoard({ pendingPurchase: pending }, { currentTurnSeat: 0, mySeatIndex: 2 });
      expect(someoneElses.text()).toContain('Waiting for Alice');
      expect(someoneElses.findAll('.ms-action button').some((b) => b.text() === 'Buy')).toBe(false);
    });

    it('emits buy-decision with the right value', async () => {
      const wrapper = mountBoard({ pendingPurchase: { spaceIndex: 3, price: 60 } });
      const buttons = wrapper.findAll('.ms-action button');
      await buttons.find((b) => b.text() === 'Buy')?.trigger('click');
      expect(wrapper.emitted('buy-decision')?.[0]).toEqual([true]);
    });
  });

  describe('auctions with four active bidders', () => {
    const auction = {
      spaceIndex: 3,
      highestBid: 40,
      highestBidderSeat: 1,
      activeBidders: [0, 1, 2, 3],
      currentBidderSeat: 2,
      originSeat: 0,
    };

    it("shows bid controls only to the current bidder (seat 2), not seats 0, 1, or 3", () => {
      const bidder = mountBoard({ auction }, { mySeatIndex: 2 });
      expect(bidder.find('.ms-bid-input').exists()).toBe(true);

      const nonBidder = mountBoard({ auction }, { mySeatIndex: 3 });
      expect(nonBidder.find('.ms-bid-input').exists()).toBe(false);
      expect(nonBidder.text()).toContain('Waiting for Carol to bid');
    });

    it('disables Pass for whoever is currently the highest bidder', () => {
      const highBidderTurn = mountBoard(
        { auction: { ...auction, currentBidderSeat: 1 } },
        { mySeatIndex: 1 },
      );
      const passBtn = highBidderTurn.findAll('.ms-action button').find((b) => b.text() === 'Pass');
      expect(passBtn?.attributes('disabled')).toBeDefined();
    });

    it('emits place-bid with at least the highest-bid-plus-one amount', async () => {
      const wrapper = mountBoard({ auction }, { mySeatIndex: 2 });
      await wrapper.find('.ms-bid-input').setValue(45);
      await wrapper.findAll('.ms-action button').find((b) => b.text() === 'Bid')?.trigger('click');
      expect(wrapper.emitted('place-bid')?.[0]).toEqual([45]);
    });
  });

  describe('pending debt with four players', () => {
    it("shows Pay debt / Declare bankruptcy only to the debtor, naming the payee among the other three", () => {
      const pendingDebt = { amount: 500, payeeSeat: 2, reason: 'rent' as const };
      const debtor = mountBoard({ pendingDebt }, { currentTurnSeat: 1, mySeatIndex: 1 });
      expect(debtor.text()).toContain('Carol');
      expect(debtor.findAll('.ms-action button').some((b) => b.text() === 'Declare bankruptcy')).toBe(true);

      const spectator = mountBoard({ pendingDebt }, { currentTurnSeat: 1, mySeatIndex: 3 });
      expect(spectator.text()).toContain("Waiting for them to resolve it");
      expect(spectator.findAll('.ms-action button').some((b) => b.text() === 'Declare bankruptcy')).toBe(false);
    });

    it('disables Pay debt when the debtor cannot afford it, enables it once they can', () => {
      const pendingDebt = { amount: 500, payeeSeat: 2, reason: 'tax' as const };
      const poor = mountBoard(
        {
          pendingDebt,
          players: {
            ...baseState().players,
            1: { cash: 10, position: 4, inJail: false, bankrupt: false, jailFreeCards: 0 },
          },
        },
        { currentTurnSeat: 1, mySeatIndex: 1 },
      );
      const payBtnPoor = poor.findAll('.ms-action button').find((b) => b.text() === 'Pay debt');
      expect(payBtnPoor?.attributes('disabled')).toBeDefined();

      const rich = mountBoard(
        {
          pendingDebt,
          players: {
            ...baseState().players,
            1: { cash: 600, position: 4, inJail: false, bankrupt: false, jailFreeCards: 0 },
          },
        },
        { currentTurnSeat: 1, mySeatIndex: 1 },
      );
      const payBtnRich = rich.findAll('.ms-action button').find((b) => b.text() === 'Pay debt');
      expect(payBtnRich?.attributes('disabled')).toBeUndefined();
    });
  });

  describe('trading among four players', () => {
    it('offers every other active (non-bankrupt) player as a trade target, excluding yourself', async () => {
      const wrapper = mountBoard(
        {
          players: {
            0: { cash: 1500, position: 0, inJail: false, bankrupt: false, jailFreeCards: 0 },
            1: { cash: 1500, position: 0, inJail: false, bankrupt: false, jailFreeCards: 0 },
            2: { cash: 0, position: 0, inJail: false, bankrupt: true, jailFreeCards: 0 },
            3: { cash: 1500, position: 0, inJail: false, bankrupt: false, jailFreeCards: 0 },
          },
        },
        { mySeatIndex: 0 },
      );
      const proposeBtn = wrapper.findAll('.ms-action button').find((b) => b.text() === 'Propose a trade');
      await proposeBtn?.trigger('click');
      const options = wrapper.find('select').findAll('option').map((o) => o.text());
      // Bob and Dan, but not Alice (self) or the bankrupt Carol.
      expect(options).toEqual(['Bob', 'Dan']);
    });

    it('lists only properties the trade target actually owns as requestable', async () => {
      const wrapper = mountBoard(
        {
          properties: {
            ...baseState().properties,
            1: { ownerSeat: 1, houses: 0, mortgaged: false }, // Bob owns Molavi
            6: { ownerSeat: 2, houses: 0, mortgaged: false }, // Carol owns Naziabad
          },
        },
        { mySeatIndex: 0 },
      );
      await wrapper
        .findAll('.ms-action button')
        .find((b) => b.text() === 'Propose a trade')
        ?.trigger('click');
      await wrapper.find('select').setValue('1'); // target Bob
      const labels = wrapper.findAll('.ms-trade-props')[1].findAll('label').map((l) => l.text());
      expect(labels).toEqual(['Molavi']);
    });

    it('shows incoming trade offers with Accept for the recipient and Cancel for the proposer', () => {
      const trades = [
        {
          id: 't1',
          fromSeat: 0,
          toSeat: 1,
          offerCash: 50,
          offerProperties: [],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [],
          requestJailCards: 0,
        },
      ];
      const recipient = mountBoard({ trades }, { mySeatIndex: 1 });
      expect(recipient.findAll('.ms-trade-btn').some((b) => b.text() === 'Accept')).toBe(true);

      const proposer = mountBoard({ trades }, { mySeatIndex: 0 });
      expect(proposer.findAll('.ms-trade-btn').some((b) => b.text() === 'Accept')).toBe(false);
      expect(proposer.findAll('.ms-trade-btn').some((b) => b.text() === 'Cancel')).toBe(true);

      const uninvolved = mountBoard({ trades }, { mySeatIndex: 2 });
      expect(uninvolved.findAll('.ms-trade-row')).toHaveLength(0);
    });

    it('emits respond-trade with the trade id on accept', async () => {
      const trades = [
        {
          id: 't-abc',
          fromSeat: 0,
          toSeat: 1,
          offerCash: 50,
          offerProperties: [],
          offerJailCards: 0,
          requestCash: 0,
          requestProperties: [],
          requestJailCards: 0,
        },
      ];
      const wrapper = mountBoard({ trades }, { mySeatIndex: 1 });
      await wrapper.findAll('.ms-trade-btn').find((b) => b.text() === 'Accept')?.trigger('click');
      expect(wrapper.emitted('respond-trade')?.[0]).toEqual(['t-abc', true]);
    });
  });
});
