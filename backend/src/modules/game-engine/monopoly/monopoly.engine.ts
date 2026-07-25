import { Injectable } from '@nestjs/common';
import {
  GameEngine,
  MoveResult,
  RollResult,
  RoomPlayerSeat,
} from '../game-engine.interface';
import {
  BOARD,
  CardEffect,
  CHANCE_CARDS,
  CHEST_CARDS,
  GO_BONUS,
  HOTEL_LEVEL,
  JAIL_FINE,
  JAIL_SPACE_INDEX,
  MAX_JAIL_TURNS,
  STARTING_CASH,
} from './board-config';

export interface MonopolyPlayerState {
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  bankrupt: boolean;
  jailFreeCards: number;
  doublesStreak: number;
}

export interface MonopolyPropertyState {
  ownerSeat: number | null;
  houses: number; // 0-4, 5 = hotel
  mortgaged: boolean;
}

export interface MonopolyAuctionState {
  spaceIndex: number;
  highestBid: number;
  highestBidderSeat: number | null;
  activeBidders: number[];
  currentBidderSeat: number;
  // Whoever declined/couldn't afford the property -- the main game turn
  // resumes from here (not from whoever wins the auction) once it ends.
  originSeat: number;
}

export interface MonopolyTradeOffer {
  id: string;
  fromSeat: number;
  toSeat: number;
  offerCash: number;
  offerProperties: number[];
  offerJailCards: number;
  requestCash: number;
  requestProperties: number[];
  requestJailCards: number;
}

export interface MonopolyState {
  players: Record<number, MonopolyPlayerState>;
  properties: Record<number, MonopolyPropertyState>;
  pendingPurchase: { spaceIndex: number; price: number } | null;
  auction: MonopolyAuctionState | null;
  trades: MonopolyTradeOffer[];
  extraRollPending: boolean;
  lastCard: { deck: 'chance' | 'chest'; text: string } | null;
  lastDice: [number, number] | null;
}

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function cloneState(state: MonopolyState): MonopolyState {
  return JSON.parse(JSON.stringify(state)) as MonopolyState;
}

function activeSeats(seats: RoomPlayerSeat[], state: MonopolyState): number[] {
  return seats
    .map((s) => s.seatIndex)
    .filter((idx) => !state.players[idx]?.bankrupt)
    .sort((a, b) => a - b);
}

function nextActiveSeat(
  seats: RoomPlayerSeat[],
  state: MonopolyState,
  current: number,
): number {
  const active = activeSeats(seats, state);
  if (active.length === 0) return current;
  const idx = active.indexOf(current);
  if (idx === -1) return active[0];
  return active[(idx + 1) % active.length];
}

function groupSpaces(group: string) {
  return BOARD.filter((s) => s.type === 'property' && s.group === group);
}

function ownedGroupCount(
  state: MonopolyState,
  ownerSeat: number,
  group: string,
): number {
  return groupSpaces(group).filter(
    (s) => state.properties[s.index]?.ownerSeat === ownerSeat,
  ).length;
}

function mortgageValue(space: (typeof BOARD)[number]): number {
  return Math.floor((space.price ?? 0) / 2);
}

function unmortgageCost(space: (typeof BOARD)[number]): number {
  const value = mortgageValue(space);
  return value + Math.ceil(value * 0.1);
}

function computeRent(state: MonopolyState, spaceIndex: number): number {
  const space = BOARD[spaceIndex];
  const propState = state.properties[spaceIndex];
  if (!propState || propState.ownerSeat == null || propState.mortgaged) {
    return 0;
  }

  if (space.type === 'property') {
    return space.rent![propState.houses];
  }
  if (space.type === 'transit') {
    const count = BOARD.filter((s) => s.type === 'transit').filter(
      (s) => state.properties[s.index]?.ownerSeat === propState.ownerSeat,
    ).length;
    return [0, 25, 50, 100, 200][count] ?? 200;
  }
  if (space.type === 'utility') {
    const count = BOARD.filter((s) => s.type === 'utility').filter(
      (s) => state.properties[s.index]?.ownerSeat === propState.ownerSeat,
    ).length;
    const multiplier = count >= 2 ? 10 : 4;
    const [d1, d2] = state.lastDice ?? [1, 1];
    return (d1 + d2) * multiplier;
  }
  return 0;
}

/**
 * Debts are always paid in full by the bank covering any shortfall -- we
 * don't model liquidating specific assets to pay a specific creditor.
 * That's a deliberate simplification for this core-loop version (no
 * trading/auctions yet either); bankruptcy still returns all of the
 * bankrupt player's properties to the bank and removes them from play.
 */
function chargePlayer(
  state: MonopolyState,
  seatIndex: number,
  amount: number,
  payeeSeat?: number,
): { bankrupt: boolean } {
  const player = state.players[seatIndex];
  player.cash -= amount;
  if (payeeSeat != null) {
    state.players[payeeSeat].cash += amount;
  }
  if (player.cash < 0) {
    for (const space of BOARD) {
      if (
        space.type !== 'property' &&
        space.type !== 'transit' &&
        space.type !== 'utility'
      ) {
        continue;
      }
      const propState = state.properties[space.index];
      if (propState?.ownerSeat === seatIndex) {
        propState.ownerSeat = null;
        propState.houses = 0;
        propState.mortgaged = false;
      }
    }
    player.bankrupt = true;
    player.cash = 0;
    return { bankrupt: true };
  }
  return { bankrupt: false };
}

@Injectable()
export class MonopolyEngine implements GameEngine {
  createInitialState(
    seats: RoomPlayerSeat[],
    rules: Record<string, unknown>,
  ): Record<string, unknown> {
    const startingCash = (rules?.startingCash as number) ?? STARTING_CASH;
    const players: Record<number, MonopolyPlayerState> = {};
    for (const seat of seats) {
      players[seat.seatIndex] = {
        cash: startingCash,
        position: 0,
        inJail: false,
        jailTurns: 0,
        bankrupt: false,
        jailFreeCards: 0,
        doublesStreak: 0,
      };
    }

    const properties: Record<number, MonopolyPropertyState> = {};
    for (const space of BOARD) {
      if (
        space.type === 'property' ||
        space.type === 'transit' ||
        space.type === 'utility'
      ) {
        properties[space.index] = {
          ownerSeat: null,
          houses: 0,
          mortgaged: false,
        };
      }
    }

    const state: MonopolyState = {
      players,
      properties,
      pendingPurchase: null,
      auction: null,
      trades: [],
      extraRollPending: false,
      lastCard: null,
      lastDice: null,
    };
    return state as unknown as Record<string, unknown>;
  }

  rollDice(
    boardStateIn: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
  ): RollResult {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const player = state.players[seatIndex];

    if (!player || player.bankrupt) {
      const nextSeat = nextActiveSeat(seats, state, seatIndex);
      const active = activeSeats(seats, state);
      return {
        diceValue: 0,
        autoResolved: true,
        moveResult: this.finish(state, nextSeat, active, seatIndex, {
          skipped: true,
        }),
      };
    }

    const d1 = rollDie();
    const d2 = rollDie();
    const isDoubles = d1 === d2;
    const sum = d1 + d2;
    state.lastDice = [d1, d2];
    const movePayload: Record<string, unknown> = { die1: d1, die2: d2, isDoubles };

    const wasInJail = player.inJail;

    if (wasInJail) {
      if (isDoubles) {
        player.inJail = false;
        player.jailTurns = 0;
        movePayload.jailEvent = 'rolled_out';
      } else {
        player.jailTurns += 1;
        if (player.jailTurns >= MAX_JAIL_TURNS) {
          const result = chargePlayer(state, seatIndex, JAIL_FINE);
          player.inJail = false;
          player.jailTurns = 0;
          movePayload.jailEvent = 'forced_fine';
          if (result.bankrupt) {
            const nextSeat = nextActiveSeat(seats, state, seatIndex);
            const active = activeSeats(seats, state);
            return {
              diceValue: sum,
              autoResolved: true,
              moveResult: this.finish(state, nextSeat, active, seatIndex, {
                ...movePayload,
                wentBankrupt: true,
              }),
            };
          }
        } else {
          movePayload.jailEvent = 'stayed';
          const nextSeat = nextActiveSeat(seats, state, seatIndex);
          return {
            diceValue: sum,
            autoResolved: true,
            moveResult: {
              boardState: state as unknown as Record<string, unknown>,
              nextTurnSeat: nextSeat,
              isGameOver: false,
              movePayload,
            },
          };
        }
      }
    }

    const from = player.position;
    const newPos = (from + sum) % BOARD.length;
    const passedGo = from + sum >= BOARD.length;
    if (passedGo) player.cash += GO_BONUS;
    player.position = newPos;
    movePayload.from = from;
    movePayload.to = newPos;
    movePayload.passedGo = passedGo;

    let sentToJailForDoubles = false;
    if (!wasInJail) {
      if (isDoubles) {
        player.doublesStreak += 1;
        if (player.doublesStreak >= 3) {
          sentToJailForDoubles = true;
          player.position = JAIL_SPACE_INDEX;
          player.inJail = true;
          player.doublesStreak = 0;
          state.extraRollPending = false;
          movePayload.sentToJail = 'triple_doubles';
        } else {
          state.extraRollPending = true;
        }
      } else {
        player.doublesStreak = 0;
        state.extraRollPending = false;
      }
    } else {
      state.extraRollPending = false;
    }

    if (!sentToJailForDoubles) {
      this.resolveLanding(state, seats, seatIndex, movePayload);
    }

    const active = activeSeats(seats, state);
    if (active.length <= 1) {
      return {
        diceValue: sum,
        autoResolved: true,
        moveResult: this.finish(state, seatIndex, active, seatIndex, movePayload),
      };
    }

    if (state.pendingPurchase || state.auction) {
      return {
        diceValue: sum,
        autoResolved: true,
        moveResult: {
          boardState: state as unknown as Record<string, unknown>,
          nextTurnSeat: seatIndex,
          isGameOver: false,
          movePayload,
        },
      };
    }

    const nextSeat = state.extraRollPending
      ? seatIndex
      : nextActiveSeat(seats, state, seatIndex);

    return {
      diceValue: sum,
      autoResolved: true,
      moveResult: {
        boardState: state as unknown as Record<string, unknown>,
        nextTurnSeat: nextSeat,
        isGameOver: false,
        movePayload,
      },
    };
  }

  applyMove(): MoveResult {
    throw new Error(
      'Monopoly resolves purchase decisions via dedicated events (resolvePurchaseDecision), not applyMove.',
    );
  }

  hasLegalMove(): boolean {
    return true;
  }

  /** Called by the gateway when a player answers a pending purchase offer. */
  resolvePurchaseDecision(
    boardStateIn: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
    buy: boolean,
  ): MoveResult {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const player = state.players[seatIndex];
    const pending = state.pendingPurchase;
    if (!pending) {
      throw new Error('No purchase decision is pending.');
    }

    const movePayload: Record<string, unknown> = { spaceIndex: pending.spaceIndex };
    if (buy && player.cash >= pending.price) {
      player.cash -= pending.price;
      state.properties[pending.spaceIndex].ownerSeat = seatIndex;
      movePayload.purchased = true;
      state.pendingPurchase = null;

      const active = activeSeats(seats, state);
      const fallbackNextSeat = nextActiveSeat(seats, state, seatIndex);
      return this.finish(state, fallbackNextSeat, active, seatIndex, movePayload);
    }

    // Declining sends the property to auction (among all active players,
    // including the decliner) rather than ending the turn outright -- the
    // main turn only resumes once the auction resolves.
    movePayload.purchased = false;
    state.pendingPurchase = null;
    this.startAuction(state, seats, pending.spaceIndex, seatIndex);
    movePayload.auctionStarted = state.auction != null;

    return {
      boardState: state as unknown as Record<string, unknown>,
      nextTurnSeat: seatIndex,
      isGameOver: false,
      movePayload,
    };
  }

  /** Called by the gateway when a player builds a house/hotel on their turn. */
  buildHouse(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    spaceIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const player = state.players[seatIndex];
    const space = BOARD[spaceIndex];
    if (!player || player.bankrupt) throw new Error('Invalid player.');
    if (!space || space.type !== 'property') {
      throw new Error('Not a buildable property.');
    }
    const propState = state.properties[spaceIndex];
    if (propState.ownerSeat !== seatIndex) {
      throw new Error('You do not own this property.');
    }
    if (propState.mortgaged) throw new Error('Property is mortgaged.');
    if (ownedGroupCount(state, seatIndex, space.group!) !== groupSpaces(space.group!).length) {
      throw new Error('You must own the full color group to build.');
    }
    if (propState.houses >= HOTEL_LEVEL) throw new Error('Already at a hotel.');

    const siblings = groupSpaces(space.group!);
    const minHouses = Math.min(
      ...siblings.map((s) => state.properties[s.index].houses),
    );
    if (propState.houses > minHouses) {
      throw new Error('Build evenly across the color group first.');
    }

    const cost = space.houseCost ?? 0;
    if (player.cash < cost) throw new Error('Not enough cash.');

    player.cash -= cost;
    propState.houses += 1;

    return state as unknown as Record<string, unknown>;
  }

  /** Called by the gateway when a jailed player pays the fine (or uses a card) to get out early. */
  payJailFine(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const player = state.players[seatIndex];
    if (!player || !player.inJail) throw new Error('You are not in jail.');

    if (player.jailFreeCards > 0) {
      player.jailFreeCards -= 1;
    } else {
      if (player.cash < JAIL_FINE) {
        throw new Error('Not enough cash to pay the fine.');
      }
      player.cash -= JAIL_FINE;
    }
    player.inJail = false;
    player.jailTurns = 0;

    return state as unknown as Record<string, unknown>;
  }

  /** Called by the gateway when a player mortgages an owned, house-free property for half its price. */
  mortgageProperty(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    spaceIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const space = BOARD[spaceIndex];
    const propState = state.properties[spaceIndex];
    if (!space || !propState) throw new Error('Not a mortgageable space.');
    if (propState.ownerSeat !== seatIndex) {
      throw new Error('You do not own this property.');
    }
    if (propState.mortgaged) throw new Error('Already mortgaged.');
    if (propState.houses > 0) {
      throw new Error('Sell the houses on this property before mortgaging it.');
    }

    propState.mortgaged = true;
    state.players[seatIndex].cash += mortgageValue(space);

    return state as unknown as Record<string, unknown>;
  }

  /** Called by the gateway when a player pays off a mortgaged property (value + 10% interest). */
  unmortgageProperty(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    spaceIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const space = BOARD[spaceIndex];
    const propState = state.properties[spaceIndex];
    if (!space || !propState) throw new Error('Not a mortgageable space.');
    if (propState.ownerSeat !== seatIndex) {
      throw new Error('You do not own this property.');
    }
    if (!propState.mortgaged) throw new Error('This property is not mortgaged.');

    const cost = unmortgageCost(space);
    const player = state.players[seatIndex];
    if (player.cash < cost) throw new Error('Not enough cash to unmortgage.');

    player.cash -= cost;
    propState.mortgaged = false;

    return state as unknown as Record<string, unknown>;
  }

  /** Called by the gateway when a player sells one house/hotel level back to the bank for half its cost. */
  sellHouse(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    spaceIndex: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const space = BOARD[spaceIndex];
    if (!space || space.type !== 'property') {
      throw new Error('Not a sellable property.');
    }
    const propState = state.properties[spaceIndex];
    if (propState.ownerSeat !== seatIndex) {
      throw new Error('You do not own this property.');
    }
    if (propState.houses <= 0) throw new Error('There is nothing built here to sell.');

    // Even-sell rule (the reverse of even-build): you can only sell from
    // whichever property in the group currently has the most houses, so
    // the group stays as balanced coming down as it was going up.
    const siblings = groupSpaces(space.group!);
    const maxHouses = Math.max(
      ...siblings.map((s) => state.properties[s.index].houses),
    );
    if (propState.houses < maxHouses) {
      throw new Error('Sell evenly across the color group first.');
    }

    propState.houses -= 1;
    state.players[seatIndex].cash += Math.floor((space.houseCost ?? 0) / 2);

    return state as unknown as Record<string, unknown>;
  }

  /** Called by the gateway when a player bids in an active auction. */
  placeBid(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    amount: number,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const auction = state.auction;
    if (!auction) throw new Error('No auction is in progress.');
    if (auction.currentBidderSeat !== seatIndex) {
      throw new Error('It is not your turn to bid.');
    }
    const player = state.players[seatIndex];
    if (!player || player.bankrupt) throw new Error('Invalid bidder.');
    if (amount <= auction.highestBid) {
      throw new Error('Bid must be higher than the current highest bid.');
    }
    if (amount > player.cash) {
      throw new Error('You cannot bid more than your cash.');
    }

    auction.highestBid = amount;
    auction.highestBidderSeat = seatIndex;
    const idx = auction.activeBidders.indexOf(seatIndex);
    auction.currentBidderSeat =
      auction.activeBidders[(idx + 1) % auction.activeBidders.length];

    return state as unknown as Record<string, unknown>;
  }

  /**
   * Called by the gateway when a player passes in an active auction.
   * Returns either an in-progress board state (bidding continues) or a
   * resolved MoveResult (the auction is over and the main turn resumes).
   */
  passAuction(
    boardStateIn: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
  ): { resolved: boolean; boardState: Record<string, unknown>; moveResult?: MoveResult } {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const auction = state.auction;
    if (!auction) throw new Error('No auction is in progress.');
    if (auction.currentBidderSeat !== seatIndex) {
      throw new Error('It is not your turn to bid.');
    }
    if (auction.highestBidderSeat === seatIndex) {
      throw new Error('You cannot pass while holding the highest bid.');
    }

    const idx = auction.activeBidders.indexOf(seatIndex);
    auction.activeBidders = auction.activeBidders.filter((s) => s !== seatIndex);

    if (auction.activeBidders.length <= 1) {
      const winnerSeat = auction.activeBidders[0] ?? auction.highestBidderSeat;
      const originSeat = auction.originSeat;
      const movePayload: Record<string, unknown> = { spaceIndex: auction.spaceIndex };

      if (winnerSeat != null && auction.highestBid > 0) {
        const price = auction.highestBid;
        state.players[winnerSeat].cash -= price;
        state.properties[auction.spaceIndex].ownerSeat = winnerSeat;
        movePayload.auctionWinner = winnerSeat;
        movePayload.auctionPrice = price;
      } else {
        movePayload.auctionWinner = null;
      }
      state.auction = null;

      const active = activeSeats(seats, state);
      const fallbackNextSeat = nextActiveSeat(seats, state, originSeat);
      const moveResult = this.finish(state, fallbackNextSeat, active, originSeat, movePayload);
      return { resolved: true, boardState: moveResult.boardState, moveResult };
    }

    auction.currentBidderSeat = auction.activeBidders[idx % auction.activeBidders.length];
    return { resolved: false, boardState: state as unknown as Record<string, unknown> };
  }

  /** Called by the gateway when a player proposes a trade to another player. */
  proposeTrade(
    boardStateIn: Record<string, unknown>,
    fromSeat: number,
    toSeat: number,
    offer: {
      offerCash: number;
      offerProperties: number[];
      offerJailCards: number;
      requestCash: number;
      requestProperties: number[];
      requestJailCards: number;
    },
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    if (fromSeat === toSeat) throw new Error('You cannot trade with yourself.');
    const from = state.players[fromSeat];
    const to = state.players[toSeat];
    if (!from || from.bankrupt || !to || to.bankrupt) {
      throw new Error('Invalid trade participants.');
    }
    this.assertTradeable(state, fromSeat, offer.offerProperties);
    this.assertTradeable(state, toSeat, offer.requestProperties);

    const trade: MonopolyTradeOffer = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromSeat,
      toSeat,
      offerCash: offer.offerCash,
      offerProperties: offer.offerProperties,
      offerJailCards: offer.offerJailCards,
      requestCash: offer.requestCash,
      requestProperties: offer.requestProperties,
      requestJailCards: offer.requestJailCards,
    };
    state.trades.push(trade);

    return state as unknown as Record<string, unknown>;
  }

  /**
   * Called by the gateway when either side of a trade responds. The
   * recipient (toSeat) can accept or decline; either side can cancel
   * (decline) their own pending offer.
   */
  respondToTrade(
    boardStateIn: Record<string, unknown>,
    seatIndex: number,
    tradeId: string,
    accept: boolean,
  ): Record<string, unknown> {
    const state = cloneState(boardStateIn as unknown as MonopolyState);
    const trade = state.trades.find((t) => t.id === tradeId);
    if (!trade) throw new Error('That trade offer no longer exists.');
    if (seatIndex !== trade.fromSeat && seatIndex !== trade.toSeat) {
      throw new Error('This trade is not yours to respond to.');
    }
    if (accept && seatIndex !== trade.toSeat) {
      throw new Error('Only the recipient can accept a trade.');
    }

    state.trades = state.trades.filter((t) => t.id !== tradeId);

    if (!accept) {
      return state as unknown as Record<string, unknown>;
    }

    // Re-validate everything still holds -- ownership/cash may have
    // changed since the offer was proposed.
    const from = state.players[trade.fromSeat];
    const to = state.players[trade.toSeat];
    if (!from || from.bankrupt || !to || to.bankrupt) {
      throw new Error('Invalid trade participants.');
    }
    this.assertTradeable(state, trade.fromSeat, trade.offerProperties);
    this.assertTradeable(state, trade.toSeat, trade.requestProperties);
    if (from.cash < trade.offerCash) throw new Error('Sender no longer has enough cash.');
    if (to.cash < trade.requestCash) throw new Error('Recipient no longer has enough cash.');
    if (from.jailFreeCards < trade.offerJailCards) {
      throw new Error('Sender no longer has enough jail-free cards.');
    }
    if (to.jailFreeCards < trade.requestJailCards) {
      throw new Error('Recipient no longer has enough jail-free cards.');
    }

    from.cash += trade.requestCash - trade.offerCash;
    to.cash += trade.offerCash - trade.requestCash;
    from.jailFreeCards += trade.requestJailCards - trade.offerJailCards;
    to.jailFreeCards += trade.offerJailCards - trade.requestJailCards;
    for (const spaceIndex of trade.offerProperties) {
      state.properties[spaceIndex].ownerSeat = trade.toSeat;
    }
    for (const spaceIndex of trade.requestProperties) {
      state.properties[spaceIndex].ownerSeat = trade.fromSeat;
    }

    return state as unknown as Record<string, unknown>;
  }

  /** Properties must be owned, unmortgaged, and house-free to be tradeable. */
  private assertTradeable(
    state: MonopolyState,
    ownerSeat: number,
    spaceIndices: number[],
  ): void {
    for (const spaceIndex of spaceIndices) {
      const prop = state.properties[spaceIndex];
      if (!prop || prop.ownerSeat !== ownerSeat) {
        throw new Error(`Seat ${ownerSeat} does not own ${BOARD[spaceIndex]?.name ?? spaceIndex}.`);
      }
      if (prop.mortgaged) {
        throw new Error(`${BOARD[spaceIndex].name} is mortgaged and cannot be traded.`);
      }
      if (prop.houses > 0) {
        throw new Error(`${BOARD[spaceIndex].name} has houses on it and cannot be traded.`);
      }
    }
  }

  private startAuction(
    state: MonopolyState,
    seats: RoomPlayerSeat[],
    spaceIndex: number,
    originSeat: number,
  ): void {
    const active = activeSeats(seats, state);
    if (active.length < 2) return;
    const originIdx = active.indexOf(originSeat);
    const startIdx = originIdx === -1 ? 0 : (originIdx + 1) % active.length;
    state.auction = {
      spaceIndex,
      highestBid: 0,
      highestBidderSeat: null,
      activeBidders: [...active],
      currentBidderSeat: active[startIdx],
      originSeat,
    };
  }

  private resolveLanding(
    state: MonopolyState,
    seats: RoomPlayerSeat[],
    seatIndex: number,
    movePayload: Record<string, unknown>,
  ): void {
    const player = state.players[seatIndex];
    const space = BOARD[player.position];
    movePayload.landedOn = space.name;
    movePayload.spaceType = space.type;

    switch (space.type) {
      case 'go':
      case 'jail':
      case 'free_parking':
        return;

      case 'go_to_jail':
        player.position = JAIL_SPACE_INDEX;
        player.inJail = true;
        player.doublesStreak = 0;
        state.extraRollPending = false;
        movePayload.sentToJail = 'go_to_jail_space';
        return;

      case 'tax':
        chargePlayer(state, seatIndex, space.taxAmount ?? 0);
        movePayload.taxPaid = space.taxAmount;
        return;

      case 'chance':
      case 'chest': {
        const deck = space.type === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
        const card = deck[Math.floor(Math.random() * deck.length)];
        state.lastCard = { deck: space.type, text: card.text };
        movePayload.card = card.text;
        this.applyCard(state, seatIndex, card);
        return;
      }

      case 'property':
      case 'transit':
      case 'utility': {
        const propState = state.properties[space.index];
        if (propState.ownerSeat == null) {
          if (player.cash >= (space.price ?? 0)) {
            state.pendingPurchase = {
              spaceIndex: space.index,
              price: space.price ?? 0,
            };
          } else {
            // Can't afford it -- straight to auction rather than silently
            // skipping the space.
            this.startAuction(state, seats, space.index, seatIndex);
          }
          return;
        }
        if (propState.ownerSeat === seatIndex || propState.mortgaged) {
          return;
        }
        const rent = computeRent(state, space.index);
        chargePlayer(state, seatIndex, rent, propState.ownerSeat);
        movePayload.rentPaid = rent;
        movePayload.rentPaidTo = propState.ownerSeat;
        return;
      }
    }
  }

  private applyCard(
    state: MonopolyState,
    seatIndex: number,
    card: CardEffect,
  ): void {
    const player = state.players[seatIndex];
    switch (card.type) {
      case 'collect':
        player.cash += card.amount;
        return;
      case 'pay':
        chargePlayer(state, seatIndex, card.amount);
        return;
      case 'advance_to_go':
        player.position = 0;
        player.cash += GO_BONUS;
        return;
      case 'go_to_jail':
        player.position = JAIL_SPACE_INDEX;
        player.inJail = true;
        player.doublesStreak = 0;
        state.extraRollPending = false;
        return;
      case 'get_out_of_jail_free':
        player.jailFreeCards += 1;
        return;
    }
  }

  private finish(
    state: MonopolyState,
    fallbackNextSeat: number,
    active: number[],
    currentSeat: number,
    movePayload: Record<string, unknown>,
  ): MoveResult {
    const isGameOver = active.length <= 1;
    const nextTurnSeat = isGameOver
      ? currentSeat
      : state.extraRollPending
        ? currentSeat
        : fallbackNextSeat;
    return {
      boardState: state as unknown as Record<string, unknown>,
      nextTurnSeat,
      isGameOver,
      winnerSeat: isGameOver ? active[0] : undefined,
      movePayload,
    };
  }
}
