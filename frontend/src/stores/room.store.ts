import { defineStore } from 'pinia';
import { connectSocket, getSocket } from '../api/socket.client';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from '../api/ws-events.constants';
import { TERRITORY_BY_ID } from '../components/conquest/board-config';
import {
  playAhh,
  playBankruptSting,
  playCardFlip,
  playCashRegister,
  playCoin,
  playCrash,
  playGavel,
  playHammerTap,
  playHooray,
  playJailClang,
  playStairs,
  playSwallow,
  playVictoryFanfare,
} from '../lib/game-sounds';
import { useToastStore, type ToastType } from './toast.store';
import type { Room } from '../types';

// Must match backend/src/modules/game-gateway/game.gateway.ts's
// scheduleTurnTimeoutFor -- there's no event field carrying the active
// duration, so it's mirrored here to drive the countdown display.
// Conquest turns get a much longer clock (a single turn there can span
// several reinforcements plus multiple attack rolls); every other game
// keeps the shared default.
const TURN_TIMEOUT_MS = 30_000;
const CONQUEST_TURN_TIMEOUT_MS = 10 * 60_000;
function turnTimeoutMsFor(gameTypeCode: string | undefined): number {
  return gameTypeCode === 'conquest' ? CONQUEST_TURN_TIMEOUT_MS : TURN_TIMEOUT_MS;
}

interface DiceRolledEvent {
  seatIndex: number;
  diceValue: number;
}

interface AwaitingMoveChoiceEvent {
  seatIndex: number;
  diceValue: number;
}

interface MoveAppliedEvent {
  seatIndex: number;
  boardState: Record<string, unknown>;
  nextTurnSeat: number;
  movePayload: Record<string, unknown>;
}

interface GameStartedEvent {
  boardState: Record<string, unknown>;
  currentTurnSeat: number;
  isPaused?: boolean;
}

interface GameOverEvent {
  winnerSeat?: number;
}

interface TurnSkippedEvent {
  seatIndex: number;
  reason: string;
  nextTurnSeat: number;
}

interface PlayerPresenceEvent {
  userId: string;
  seatIndex: number;
}

interface GamePausedEvent {
  seatIndex: number;
}

interface GameResumedEvent {
  seatIndex: number;
  turnDeadline: number;
}

interface OloLivePositionsEvent {
  positions: Array<{ id: string; x: number; y: number }>;
}

interface OloShotResultEvent {
  seatIndex: number;
  boardState: Record<string, unknown>;
  nextTurnSeat: number;
}

interface MonopolyStateUpdatedEvent {
  boardState: Record<string, unknown>;
  seatIndex?: number;
  builtHouse?: string;
  isHotel?: boolean;
  soldHouse?: string;
  mortgaged?: string;
  unmortgaged?: string;
  paidJailFine?: boolean;
  bidPlaced?: number;
  bidSpace?: string;
  auctionPassed?: string;
  tradeProposedTo?: number;
  tradeResponded?: boolean;
  tradeWithSeat?: number | null;
}

// These actions (build/sell/mortgage/etc.) don't consume the turn, so
// they arrive via MONOPOLY_STATE_UPDATED instead of MOVE_APPLIED --
// mirrors monopolyEventMessage/monopolyEventSound's style, just keyed
// off this event's own fields.
function monopolyStateEventMessage(
  payload: MonopolyStateUpdatedEvent,
  room: Room | null,
): string | null {
  const name =
    payload.seatIndex != null ? displayNameForSeat(room, payload.seatIndex) : 'A player';
  if (payload.builtHouse) {
    return payload.isHotel
      ? `🏨 ${name} built a hotel on ${payload.builtHouse}.`
      : `🏠 ${name} built a house on ${payload.builtHouse}.`;
  }
  if (payload.soldHouse) return `💰 ${name} sold a house on ${payload.soldHouse}.`;
  if (payload.mortgaged) return `🏦 ${name} mortgaged ${payload.mortgaged}.`;
  if (payload.unmortgaged) return `🏦 ${name} paid off the mortgage on ${payload.unmortgaged}.`;
  if (payload.paidJailFine) return `🔓 ${name} paid $50 and left jail.`;
  if (payload.bidPlaced != null) return `💰 ${name} bid $${payload.bidPlaced} on ${payload.bidSpace}.`;
  if (payload.auctionPassed) return `🙅 ${name} passed on the auction for ${payload.auctionPassed}.`;
  if (payload.tradeProposedTo != null) {
    return `🤝 ${name} proposed a trade to ${displayNameForSeat(room, payload.tradeProposedTo)}.`;
  }
  if (payload.tradeResponded != null) {
    return payload.tradeResponded
      ? `🤝 ${name} accepted a trade.`
      : `🙅 ${name} declined a trade.`;
  }
  return null;
}

function monopolyStateEventSound(payload: MonopolyStateUpdatedEvent) {
  if (payload.builtHouse) return playHammerTap();
  if (payload.soldHouse) return playCoin();
  if (payload.mortgaged) return playCoin();
  if (payload.unmortgaged) return playCoin();
  if (payload.paidJailFine) return playCoin();
  if (payload.bidPlaced != null) return playGavel();
  if (payload.tradeResponded === true) return playCashRegister();
}

export interface EventLogEntry {
  id: number;
  message: string;
  timestamp: number;
}

// Capped so the log can't grow unbounded over a long game session.
const EVENT_LOG_LIMIT = 40;

interface RoomState {
  room: Room | null;
  boardState: Record<string, unknown> | null;
  currentTurnSeat: number | null;
  lastDiceValue: number | null;
  isRolling: boolean;
  awaitingMoveChoice: boolean;
  winnerSeat: number | null;
  listenersBound: boolean;
  // Epoch ms when the current turn will be auto-skipped by the server, or
  // null when no turn timer is running (waiting room / game over).
  turnDeadline: number | null;
  // Dice value tied to the in-flight move choice, set straight from the
  // AWAITING_MOVE_CHOICE payload (unlike lastDiceValue, which is delayed
  // to line up with the dice-roll animation) so move-destination previews
  // are correct the instant a choice is awaited.
  awaitingDiceValue: number | null;
  // Most-recent-first feed of what's happened in the room, for the
  // activity log shown in RoomView.
  eventLog: EventLogEntry[];
  // Drives a brief full-screen animation in RoomView (confetti-ish pop
  // for good news, a shake for bad news); cleared automatically a moment
  // after being set.
  celebration: 'victory' | 'failure' | null;
  // OLO only: the latest live disc-position snapshot relayed from
  // whichever player is mid-shot, for OloBoard to render while spectating
  // (not persisted -- overwritten by each new packet).
  oloLiveOpponentPositions: OloLivePositionsEvent | null;
  // Monopoly only: the two individual d6 values from the last roll --
  // lastDiceValue is their *sum* (up to 12), which doesn't fit the
  // 1-6 pip die widget, so Monopoly renders two dice from this instead.
  monopolyDice: [number, number] | null;
  // Monopoly only: the most recent Chance/Community Chest card drawn, for
  // MonopolyBoard to show as a full reveal overlay. `id` is a unique
  // counter (not the card text) so a watcher can detect a fresh draw even
  // when the same card text comes up twice in a row.
  lastMonopolyCard: { deck: 'chance' | 'chest'; text: string; id: number } | null;
  // Any seated player can pause an in-progress game; while paused, every
  // turn-consuming action is rejected server-side and the turn timer is
  // frozen (turnDeadline is cleared -- see GAME_PAUSED/GAME_RESUMED below).
  isPaused: boolean;
  pausedBySeat: number | null;
  // Conquest only: the most recent attack's dice results, for ConquestBoard
  // to show as a battle-result panel. `id` is a unique counter so a
  // watcher can detect a fresh attack even when the dice values repeat.
  conquestLastCombat: (ConquestCombatResult & { id: number }) | null;
}

export interface ConquestCombatResult {
  fromId: string;
  toId: string;
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
  captured: boolean;
  eliminatedSeat: number | null;
  isGameOver: boolean;
  winnerSeat: number | null;
}

interface ConquestStateUpdatedEvent {
  boardState: Record<string, unknown>;
  seatIndex?: number;
  reinforced?: string;
  count?: number;
  movedToFortify?: boolean;
  tradedIn?: boolean;
  bonus?: number;
  territoryBonusId?: string | null;
  movedArmies?: { from: string; to: string; count: number };
}

interface ConquestAttackResultEvent {
  boardState: Record<string, unknown>;
  seatIndex: number;
  combat: ConquestCombatResult;
}

function conquestStateEventMessage(
  payload: ConquestStateUpdatedEvent,
  room: Room | null,
): string | null {
  const name = payload.seatIndex != null ? displayNameForSeat(room, payload.seatIndex) : 'A player';
  if (payload.tradedIn) {
    const bonusNote = payload.territoryBonusId
      ? ` (+2 more on ${TERRITORY_BY_ID[payload.territoryBonusId]?.name ?? payload.territoryBonusId})`
      : '';
    return `🃏 ${name} traded in a set for +${payload.bonus} armies${bonusNote}.`;
  }
  if (payload.reinforced) return `🪖 ${name} placed ${payload.count} army/armies on ${payload.reinforced}.`;
  if (payload.movedArmies) {
    const { from, to, count } = payload.movedArmies;
    return `🚚 ${name} moved ${count} army/armies from ${from} to ${to}.`;
  }
  if (payload.movedToFortify) return `⏭️ ${name} moved to the fortify phase.`;
  return null;
}

function conquestMoveMessage(
  name: string,
  payload: Record<string, unknown>,
): string {
  if (payload.timedOut) return `⏭️ ${name}'s turn timed out and was ended automatically.`;
  return `⏭️ ${name} ended their turn.`;
}

// Mirrors monopolyEventMessage's priority order, one sound per outcome.
function monopolyEventSound(payload: Record<string, unknown>) {
  if (payload.auctionWinner !== undefined) {
    if (payload.auctionWinner == null) playAhh();
    else playCashRegister();
    return;
  }
  if (payload.auctionStarted) return playGavel();
  if (payload.wentBankrupt) return playBankruptSting();
  if (payload.debtPending) return playAhh();
  if (payload.debtPaid) return playCoin();
  if (payload.sentToJail) return playJailClang();
  if (payload.jailEvent === 'rolled_out') return playHooray();
  if (payload.jailEvent === 'forced_fine') return playCoin();
  if (payload.jailEvent === 'stayed') return playJailClang();
  if (payload.purchased === true) return playCashRegister();
  if (payload.card) return playCardFlip();
  if (payload.taxPaid) return playCoin();
  if (payload.rentPaid) return playCoin();
}

function monopolyEventMessage(
  name: string,
  payload: Record<string, unknown>,
  room: Room | null,
): string {
  if (payload.auctionWinner !== undefined) {
    if (payload.auctionWinner == null) return `🔨 Auction closed with no bids.`;
    const winnerName = displayNameForSeat(room, payload.auctionWinner as number);
    return `🔨 ${winnerName} won the auction for $${payload.auctionPrice}.`;
  }
  if (payload.auctionStarted) return `🔨 ${name} passed -- going to auction.`;
  if (payload.skipped) return `⏭️ ${name} has no properties left to lose -- skipped.`;
  if (payload.wentBankrupt) return `💸 ${name} went bankrupt!`;
  if (payload.debtPending) return `⚠️ ${name} owes $${payload.debtPending} and can't cover it!`;
  if (payload.debtPaid) return `💰 ${name} paid off a $${payload.debtPaid} debt.`;
  if (payload.sentToJail) return `🚔 ${name} was sent to jail.`;
  if (payload.jailEvent === 'rolled_out') {
    return `🎲 ${name} rolled doubles and got out of jail!`;
  }
  if (payload.jailEvent === 'forced_fine') {
    return `💰 ${name} paid the fine to leave jail.`;
  }
  if (payload.jailEvent === 'stayed') return `⛓️ ${name} stayed in jail.`;
  if (payload.purchased === true) return `🏠 ${name} bought a property.`;
  if (payload.purchased === false) return `🙅 ${name} declined to buy.`;
  if (payload.card) return `🃏 ${name} drew a card: ${payload.card as string}`;
  if (payload.taxPaid) return `🧾 ${name} paid $${payload.taxPaid} in tax.`;
  if (payload.rentPaid) return `💵 ${name} paid $${payload.rentPaid} in rent.`;
  if (payload.landedOn) return `♟️ ${name} landed on ${payload.landedOn as string}.`;
  return `♟️ ${name} moved.`;
}

function displayNameForSeat(room: Room | null, seatIndex: number): string {
  return (
    room?.players.find((p) => p.seatIndex === seatIndex)?.displayName ??
    'A player'
  );
}

let celebrationTimer: ReturnType<typeof setTimeout> | undefined;

let nextEventLogId = 1;
let nextMonopolyCardId = 1;
let nextConquestCombatId = 1;

export const useRoomStore = defineStore('room', {
  state: (): RoomState => ({
    room: null,
    boardState: null,
    currentTurnSeat: null,
    lastDiceValue: null,
    isRolling: false,
    awaitingMoveChoice: false,
    winnerSeat: null,
    listenersBound: false,
    turnDeadline: null,
    awaitingDiceValue: null,
    eventLog: [],
    celebration: null,
    oloLiveOpponentPositions: null,
    monopolyDice: null,
    lastMonopolyCard: null,
    isPaused: false,
    pausedBySeat: null,
    conquestLastCombat: null,
  }),

  actions: {
    // Every activity-log entry also pops a toast by default, so nothing
    // that happens in a room goes unnoticed even if the sidebar log isn't
    // in view. Pass toastType: null to log without toasting (reserved for
    // entries that would otherwise double up with a toast already shown
    // elsewhere for the same event).
    pushEvent(
      message: string,
      toastType: ToastType | null = 'info',
      durationMs?: number,
    ) {
      this.eventLog.unshift({
        id: nextEventLogId++,
        message,
        timestamp: Date.now(),
      });
      if (this.eventLog.length > EVENT_LOG_LIMIT) {
        this.eventLog.length = EVENT_LOG_LIMIT;
      }
      if (toastType) {
        useToastStore().show(message, toastType, durationMs);
      }
    },

    triggerCelebration(kind: 'victory' | 'failure') {
      this.celebration = kind;
      if (celebrationTimer) clearTimeout(celebrationTimer);
      celebrationTimer = setTimeout(() => {
        this.celebration = null;
      }, 1100);
    },

    bindSocketListeners() {
      if (this.listenersBound) return;
      const socket = getSocket();
      const toastStore = useToastStore();

      socket.on(WS_EVENTS_OUT.ROOM_STATE, (room: Room) => {
        this.room = room;
      });

      socket.on(WS_EVENTS_OUT.GAME_STARTED, (payload: GameStartedEvent) => {
        this.boardState = payload.boardState;
        this.currentTurnSeat = payload.currentTurnSeat;
        this.winnerSeat = null;
        this.awaitingMoveChoice = false;
        this.awaitingDiceValue = null;
        this.isRolling = false;
        this.monopolyDice = null;
        this.lastMonopolyCard = null;
        this.conquestLastCombat = null;
        // Also fires on rejoin/reconnect (see onJoinRoom on the backend),
        // so a paused room's turn timer must NOT be reset to a fresh 30s
        // for whoever's rejoining -- respect the server's isPaused flag.
        this.isPaused = payload.isPaused ?? false;
        this.pausedBySeat = null;
        this.turnDeadline = this.isPaused ? null : Date.now() + turnTimeoutMsFor(this.room?.gameType.code);
        this.pushEvent('🎲 The game has started!', 'success');
      });

      socket.on(WS_EVENTS_OUT.DICE_ROLLED, (payload: DiceRolledEvent) => {
        // isRolling was already set optimistically by rollDice(); this
        // confirms the server-authoritative value once it arrives. We
        // keep the rolling animation visible briefly so the dice-roll
        // feels like an action rather than an instant state flip.
        window.setTimeout(() => {
          this.lastDiceValue = payload.diceValue;
          this.isRolling = false;
        }, 500);
        const name = displayNameForSeat(this.room, payload.seatIndex);
        this.pushEvent(`🎲 ${name} rolled a ${payload.diceValue}.`, 'info', 2500);
        if (payload.diceValue === 6) {
          playHooray();
        }
      });

      socket.on(WS_EVENTS_OUT.GAME_PAUSED, (payload: GamePausedEvent) => {
        this.isPaused = true;
        this.pausedBySeat = payload.seatIndex;
        this.turnDeadline = null;
        const name = displayNameForSeat(this.room, payload.seatIndex);
        this.pushEvent(`⏸️ ${name} paused the game.`, 'info');
      });

      socket.on(WS_EVENTS_OUT.GAME_RESUMED, (payload: GameResumedEvent) => {
        this.isPaused = false;
        this.pausedBySeat = null;
        this.turnDeadline = payload.turnDeadline;
        const name = displayNameForSeat(this.room, payload.seatIndex);
        this.pushEvent(`▶️ ${name} resumed the game.`, 'success');
      });

      socket.on(
        WS_EVENTS_OUT.AWAITING_MOVE_CHOICE,
        (payload: AwaitingMoveChoiceEvent) => {
          this.awaitingMoveChoice = true;
          this.awaitingDiceValue = payload.diceValue;
          this.turnDeadline = Date.now() + turnTimeoutMsFor(this.room?.gameType.code);
        },
      );

      socket.on(WS_EVENTS_OUT.MOVE_APPLIED, (payload: MoveAppliedEvent) => {
        this.boardState = payload.boardState;
        this.currentTurnSeat = payload.nextTurnSeat;
        this.awaitingMoveChoice = false;
        this.awaitingDiceValue = null;
        // Optimistic reschedule; a GAME_OVER right behind this clears it.
        this.turnDeadline = Date.now() + turnTimeoutMsFor(this.room?.gameType.code);

        const name = displayNameForSeat(this.room, payload.seatIndex);
        const movePayload = payload.movePayload ?? {};
        const captured = movePayload.captured as
          | Array<{ seatIndex: number; tokenId: number }>
          | undefined;

        // Snake/ladder detection: the raw square a token landed on
        // (before the engine resolved the snake/ladder teleport) is
        // where a bite/climb would show up in that game's config map.
        const isSnakesLadders = this.room?.gameType.code === 'snakes_ladders';
        const from = movePayload.from as number | undefined;
        const rolled = movePayload.rolled as number | undefined;
        const rawLanding =
          from != null && rolled != null ? from + rolled : undefined;
        const slBoard = payload.boardState as {
          snakes?: Record<number, number>;
          ladders?: Record<number, number>;
        };

        const isMonopoly = this.room?.gameType.code === 'monopoly';
        const isConquest = this.room?.gameType.code === 'conquest';

        if (isConquest) {
          this.pushEvent(conquestMoveMessage(name, movePayload), 'info', 2500);
          if (movePayload.drewCard) {
            this.pushEvent(`🃏 ${name} drew a card.`, 'info', 2500);
            playCardFlip();
          }
        } else if (isMonopoly) {
          const die1 = movePayload.die1 as number | undefined;
          const die2 = movePayload.die2 as number | undefined;
          if (die1 != null && die2 != null) {
            this.monopolyDice = [die1, die2];
          }
          const cardText = movePayload.card as string | undefined;
          const spaceType = movePayload.spaceType as string | undefined;
          if (cardText && (spaceType === 'chance' || spaceType === 'chest')) {
            this.lastMonopolyCard = {
              deck: spaceType,
              text: cardText,
              id: nextMonopolyCardId++,
            };
          }
          this.pushEvent(monopolyEventMessage(name, movePayload, this.room), 'info', 2500);
          monopolyEventSound(movePayload);
        } else if (movePayload.noLegalMove) {
          this.pushEvent(`↪️ ${name} had no legal move.`);
          playAhh();
        } else if (captured && captured.length > 0) {
          const capturedNames = [
            ...new Set(
              captured.map((c) => displayNameForSeat(this.room, c.seatIndex)),
            ),
          ].join(', ');
          this.pushEvent(`💥 ${name} sent ${capturedNames} home!`, 'success');
          playCrash();
          this.triggerCelebration('victory');
        } else if (
          isSnakesLadders &&
          rawLanding != null &&
          slBoard.snakes?.[rawLanding] !== undefined
        ) {
          this.pushEvent(`🐍 ${name} got swallowed by a snake!`, 'error');
          playSwallow();
          this.triggerCelebration('failure');
        } else if (
          isSnakesLadders &&
          rawLanding != null &&
          slBoard.ladders?.[rawLanding] !== undefined
        ) {
          this.pushEvent(`🪜 ${name} climbed a ladder!`, 'success');
          playStairs();
          this.triggerCelebration('victory');
        } else {
          this.pushEvent(`♟️ ${name} moved.`, 'info', 2500);
        }
      });

      socket.on(WS_EVENTS_OUT.TURN_SKIPPED, (payload: TurnSkippedEvent) => {
        this.awaitingMoveChoice = false;
        this.awaitingDiceValue = null;
        this.isRolling = false;
        this.lastDiceValue = null;
        // This was missing entirely before -- without it, currentTurnSeat
        // stayed pointed at the skipped player forever, so no one's
        // client ever agreed on whose turn it actually was.
        this.currentTurnSeat = payload.nextTurnSeat;
        this.turnDeadline = Date.now() + turnTimeoutMsFor(this.room?.gameType.code);
        const name = displayNameForSeat(this.room, payload.seatIndex);
        this.pushEvent(`⏭️ ${name}'s turn was skipped (${payload.reason}).`, 'info');
        playAhh();
      });

      socket.on(WS_EVENTS_OUT.GAME_OVER, (payload: GameOverEvent) => {
        this.winnerSeat = payload.winnerSeat ?? null;
        this.turnDeadline = null;
        this.awaitingDiceValue = null;
        const name =
          payload.winnerSeat != null
            ? displayNameForSeat(this.room, payload.winnerSeat)
            : null;
        this.pushEvent(name ? `🏆 ${name} won the game!` : '🏁 Game over.', 'success');
        playVictoryFanfare();
        this.triggerCelebration('victory');
      });

      socket.on(
        WS_EVENTS_OUT.PLAYER_DISCONNECTED,
        (payload: PlayerPresenceEvent) => {
          const name = displayNameForSeat(this.room, payload.seatIndex);
          this.pushEvent(`🔌 ${name} disconnected.`, 'info');
        },
      );

      socket.on(
        WS_EVENTS_OUT.PLAYER_RECONNECTED,
        (payload: PlayerPresenceEvent) => {
          const name = displayNameForSeat(this.room, payload.seatIndex);
          this.pushEvent(`🔌 ${name} reconnected.`, 'success');
        },
      );

      socket.on(WS_EVENTS_OUT.PLAYER_KICKED, () => {
        this.pushEvent('👢 A player was removed from the room.', 'info');
      });

      socket.on(WS_EVENTS_OUT.ROOM_DELETED, () => {
        // Applies to everyone in the room, including the admin who
        // deleted it -- reset local state so RoomView's watcher sends
        // everyone back to the lobby.
        toastStore.info('This room has been deleted.');
        this.resetGameState();
      });

      socket.on(WS_EVENTS_OUT.ERROR, (payload: { message: string }) => {
        this.isRolling = false;
        toastStore.error(payload.message);
      });

      // OLO only: live position relay while the current player's shot is
      // mid-flight, and the settled result once it stops -- see OloBoard.vue.
      socket.on(
        WS_EVENTS_OUT.OLO_LIVE_POSITIONS,
        (payload: OloLivePositionsEvent) => {
          this.oloLiveOpponentPositions = payload;
        },
      );

      socket.on(WS_EVENTS_OUT.OLO_SHOT_RESULT, (payload: OloShotResultEvent) => {
        this.boardState = payload.boardState;
        this.currentTurnSeat = payload.nextTurnSeat;
        this.oloLiveOpponentPositions = null;
        this.turnDeadline = Date.now() + turnTimeoutMsFor(this.room?.gameType.code);
        const name = displayNameForSeat(this.room, payload.seatIndex);
        this.pushEvent(`🥏 ${name} took a shot.`, 'info', 2500);
      });

      // Monopoly only: building a house or paying the jail fine changes
      // boardState without consuming the turn, so it's a separate event
      // from MOVE_APPLIED (which always carries a nextTurnSeat change).
      socket.on(
        WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED,
        (payload: MonopolyStateUpdatedEvent) => {
          this.boardState = payload.boardState;
          const message = monopolyStateEventMessage(payload, this.room);
          if (message) {
            this.pushEvent(message, 'info', 2500);
            monopolyStateEventSound(payload);
          }
        },
      );

      // Conquest only: reinforcing or ending the attack phase changes
      // boardState without consuming the turn, same reasoning as Monopoly's
      // build-house above.
      socket.on(
        WS_EVENTS_OUT.CONQUEST_STATE_UPDATED,
        (payload: ConquestStateUpdatedEvent) => {
          this.boardState = payload.boardState;
          const message = conquestStateEventMessage(payload, this.room);
          if (message) {
            this.pushEvent(message, 'info', 2500);
            if (payload.reinforced) playHammerTap();
            if (payload.tradedIn) playCardFlip();
          }
        },
      );

      socket.on(
        WS_EVENTS_OUT.CONQUEST_ATTACK_RESULT,
        (payload: ConquestAttackResultEvent) => {
          this.boardState = payload.boardState;
          this.conquestLastCombat = { ...payload.combat, id: nextConquestCombatId++ };
          const name = displayNameForSeat(this.room, payload.seatIndex);
          const fromName = TERRITORY_BY_ID[payload.combat.fromId]?.name ?? payload.combat.fromId;
          const toName = TERRITORY_BY_ID[payload.combat.toId]?.name ?? payload.combat.toId;
          if (payload.combat.captured) {
            this.pushEvent(`⚔️ ${name} captured ${toName} from ${fromName}!`, 'success');
            playCashRegister();
            this.triggerCelebration('victory');
          } else {
            this.pushEvent(
              `⚔️ ${name} attacked ${toName} from ${fromName} (-${payload.combat.attackerLosses} attacker, -${payload.combat.defenderLosses} defender).`,
              'info',
              2500,
            );
            playCrash();
          }
          if (payload.combat.eliminatedSeat != null) {
            const eliminatedName = displayNameForSeat(this.room, payload.combat.eliminatedSeat);
            this.pushEvent(`💀 ${eliminatedName} has been eliminated!`, 'error');
            playBankruptSting();
          }
        },
      );

      this.listenersBound = true;
    },

    connect() {
      connectSocket();
      this.bindSocketListeners();
    },

    joinRoom(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.JOIN_ROOM, { roomId });
    },

    leaveRoom(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.LEAVE_ROOM, { roomId });
      this.resetGameState();
    },

    startGame(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.START_GAME, { roomId });
    },

    pauseGame(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.PAUSE_GAME, { roomId });
    },

    resumeGame(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.RESUME_GAME, { roomId });
    },

    rollDice(roomId: string) {
      this.isRolling = true;
      getSocket().emit(WS_EVENTS_IN.ROLL_DICE, { roomId });
    },

    makeMove(roomId: string, tokenId: number) {
      getSocket().emit(WS_EVENTS_IN.MAKE_MOVE, { roomId, tokenId });
    },

    sendOloLivePositions(
      roomId: string,
      positions: Array<{ id: string; x: number; y: number }>,
    ) {
      getSocket().emit(WS_EVENTS_IN.OLO_LIVE_POSITIONS, { roomId, positions });
    },

    sendOloShotResult(
      roomId: string,
      payload: {
        boardState: Record<string, unknown>;
        nextTurnSeat: number;
        isGameOver: boolean;
        winnerSeat?: number;
      },
    ) {
      getSocket().emit(WS_EVENTS_IN.OLO_SHOT_RESULT, { roomId, ...payload });
    },

    monopolyPurchaseDecision(roomId: string, buy: boolean) {
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_PURCHASE_DECISION, { roomId, buy });
    },

    monopolyBuildHouse(roomId: string, spaceIndex: number) {
      // Sound/log entry arrive via the MONOPOLY_STATE_UPDATED broadcast
      // (which reaches the sender too), so no optimistic playback here --
      // avoids double-playing the sound for the acting player.
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_BUILD_HOUSE, { roomId, spaceIndex });
    },

    monopolyPayJailFine(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_PAY_JAIL_FINE, { roomId });
    },

    monopolyPlaceBid(roomId: string, amount: number) {
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_PLACE_BID, { roomId, amount });
    },

    monopolyPassAuction(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_PASS_AUCTION, { roomId });
    },

    monopolyProposeTrade(
      roomId: string,
      offer: {
        toSeat: number;
        offerCash: number;
        offerProperties: number[];
        offerJailCards: number;
        requestCash: number;
        requestProperties: number[];
        requestJailCards: number;
      },
    ) {
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_PROPOSE_TRADE, { roomId, ...offer });
    },

    monopolyRespondTrade(roomId: string, tradeId: string, accept: boolean) {
      if (accept) playCashRegister();
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_RESPOND_TRADE, { roomId, tradeId, accept });
    },

    monopolyMortgage(roomId: string, spaceIndex: number) {
      playCashRegister();
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_MORTGAGE, { roomId, spaceIndex });
    },

    monopolyUnmortgage(roomId: string, spaceIndex: number) {
      playCoin();
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_UNMORTGAGE, { roomId, spaceIndex });
    },

    monopolySellHouse(roomId: string, spaceIndex: number) {
      playCoin();
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_SELL_HOUSE, { roomId, spaceIndex });
    },

    monopolyPayDebt(roomId: string) {
      playCoin();
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_PAY_DEBT, { roomId });
    },

    monopolyDeclareBankruptcy(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.MONOPOLY_DECLARE_BANKRUPTCY, { roomId });
    },

    conquestReinforce(roomId: string, territoryId: string, count: number) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_REINFORCE, { roomId, territoryId, count });
    },

    conquestMoveArmies(roomId: string, fromId: string, toId: string, count: number) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_MOVE_ARMIES, { roomId, fromId, toId, count });
    },

    conquestAttack(roomId: string, fromId: string, toId: string, diceCount: number) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_ATTACK, { roomId, fromId, toId, diceCount });
    },

    conquestEndAttackPhase(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_END_ATTACK_PHASE, { roomId });
    },

    conquestEndTurn(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_END_TURN, { roomId });
    },

    conquestTradeCards(roomId: string, cardIds: string[]) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_TRADE_CARDS, { roomId, cardIds });
    },

    conquestPassTurn(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.CONQUEST_PASS_TURN, { roomId });
    },

    kickPlayer(roomId: string, targetUserId: string) {
      getSocket().emit(WS_EVENTS_IN.KICK_PLAYER, { roomId, targetUserId });
    },

    deleteRoom(roomId: string) {
      getSocket().emit(WS_EVENTS_IN.DELETE_ROOM, { roomId });
    },

    resetGameState() {
      this.room = null;
      this.boardState = null;
      this.currentTurnSeat = null;
      this.lastDiceValue = null;
      this.isRolling = false;
      this.awaitingMoveChoice = false;
      this.winnerSeat = null;
      this.turnDeadline = null;
      this.awaitingDiceValue = null;
      this.eventLog = [];
      if (celebrationTimer) clearTimeout(celebrationTimer);
      this.celebration = null;
      this.oloLiveOpponentPositions = null;
      this.monopolyDice = null;
      this.lastMonopolyCard = null;
      this.isPaused = false;
      this.pausedBySeat = null;
      this.conquestLastCombat = null;
    },
  },
});
