import { defineStore } from 'pinia';
import { connectSocket, getSocket } from '../api/socket.client';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from '../api/ws-events.constants';
import {
  playAhh,
  playHooray,
  playStairs,
  playSwallow,
} from '../lib/game-sounds';
import { useToastStore } from './toast.store';
import type { Room } from '../types';

// Must match backend/src/modules/game-gateway/room-scheduler.service.ts
// TURN_TIMEOUT_MS -- there's no event field carrying this, so it's
// mirrored here to drive the countdown display.
const TURN_TIMEOUT_MS = 30_000;

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
}

interface GameOverEvent {
  winnerSeat?: number;
}

interface TurnSkippedEvent {
  seatIndex: number;
  reason: string;
}

interface PlayerPresenceEvent {
  userId: string;
  seatIndex: number;
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
}

function displayNameForSeat(room: Room | null, seatIndex: number): string {
  return (
    room?.players.find((p) => p.seatIndex === seatIndex)?.displayName ??
    'A player'
  );
}

let celebrationTimer: ReturnType<typeof setTimeout> | undefined;

let nextEventLogId = 1;

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
  }),

  actions: {
    pushEvent(message: string) {
      this.eventLog.unshift({
        id: nextEventLogId++,
        message,
        timestamp: Date.now(),
      });
      if (this.eventLog.length > EVENT_LOG_LIMIT) {
        this.eventLog.length = EVENT_LOG_LIMIT;
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
        this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
        toastStore.success('The game has started!');
        this.pushEvent('🎲 The game has started!');
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
        this.pushEvent(`🎲 ${name} rolled a ${payload.diceValue}.`);
      });

      socket.on(
        WS_EVENTS_OUT.AWAITING_MOVE_CHOICE,
        (payload: AwaitingMoveChoiceEvent) => {
          this.awaitingMoveChoice = true;
          this.awaitingDiceValue = payload.diceValue;
          this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
        },
      );

      socket.on(WS_EVENTS_OUT.MOVE_APPLIED, (payload: MoveAppliedEvent) => {
        this.boardState = payload.boardState;
        this.currentTurnSeat = payload.nextTurnSeat;
        this.awaitingMoveChoice = false;
        this.awaitingDiceValue = null;
        // Optimistic reschedule; a GAME_OVER right behind this clears it.
        this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

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

        if (movePayload.noLegalMove) {
          this.pushEvent(`↪️ ${name} had no legal move.`);
          playAhh();
        } else if (captured && captured.length > 0) {
          const capturedNames = [
            ...new Set(
              captured.map((c) => displayNameForSeat(this.room, c.seatIndex)),
            ),
          ].join(', ');
          this.pushEvent(`💥 ${name} sent ${capturedNames} home!`);
          playHooray();
          this.triggerCelebration('victory');
        } else if (
          isSnakesLadders &&
          rawLanding != null &&
          slBoard.snakes?.[rawLanding] !== undefined
        ) {
          this.pushEvent(`🐍 ${name} got swallowed by a snake!`);
          playSwallow();
          this.triggerCelebration('failure');
        } else if (
          isSnakesLadders &&
          rawLanding != null &&
          slBoard.ladders?.[rawLanding] !== undefined
        ) {
          this.pushEvent(`🪜 ${name} climbed a ladder!`);
          playStairs();
          this.triggerCelebration('victory');
        } else {
          this.pushEvent(`♟️ ${name} moved.`);
        }
      });

      socket.on(WS_EVENTS_OUT.TURN_SKIPPED, (payload: TurnSkippedEvent) => {
        this.awaitingMoveChoice = false;
        this.awaitingDiceValue = null;
        this.isRolling = false;
        this.lastDiceValue = null;
        this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
        const name = displayNameForSeat(this.room, payload.seatIndex);
        toastStore.info(`${name}'s turn was skipped (${payload.reason}).`);
        this.pushEvent(`⏭️ ${name}'s turn was skipped (${payload.reason}).`);
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
        this.pushEvent(name ? `🏆 ${name} won the game!` : '🏁 Game over.');
        playHooray();
        this.triggerCelebration('victory');
      });

      socket.on(
        WS_EVENTS_OUT.PLAYER_DISCONNECTED,
        (payload: PlayerPresenceEvent) => {
          const name = displayNameForSeat(this.room, payload.seatIndex);
          toastStore.info(`${name} disconnected.`);
          this.pushEvent(`🔌 ${name} disconnected.`);
        },
      );

      socket.on(
        WS_EVENTS_OUT.PLAYER_RECONNECTED,
        (payload: PlayerPresenceEvent) => {
          const name = displayNameForSeat(this.room, payload.seatIndex);
          toastStore.success(`${name} reconnected.`);
          this.pushEvent(`🔌 ${name} reconnected.`);
        },
      );

      socket.on(WS_EVENTS_OUT.PLAYER_KICKED, () => {
        toastStore.info('A player was removed from the room.');
        this.pushEvent('👢 A player was removed from the room.');
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

    rollDice(roomId: string) {
      this.isRolling = true;
      getSocket().emit(WS_EVENTS_IN.ROLL_DICE, { roomId });
    },

    makeMove(roomId: string, tokenId: number) {
      getSocket().emit(WS_EVENTS_IN.MAKE_MOVE, { roomId, tokenId });
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
    },
  },
});
