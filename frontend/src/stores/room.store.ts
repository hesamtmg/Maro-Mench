import { defineStore } from 'pinia';
import { connectSocket, getSocket } from '../api/socket.client';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from '../api/ws-events.constants';
import { useToastStore } from './toast.store';
import type { Room } from '../types';

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

interface RoomState {
  room: Room | null;
  boardState: Record<string, unknown> | null;
  currentTurnSeat: number | null;
  lastDiceValue: number | null;
  isRolling: boolean;
  awaitingMoveChoice: boolean;
  winnerSeat: number | null;
  listenersBound: boolean;
}

function displayNameForSeat(room: Room | null, seatIndex: number): string {
  return (
    room?.players.find((p) => p.seatIndex === seatIndex)?.displayName ??
    'A player'
  );
}

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
  }),

  actions: {
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
        this.isRolling = false;
        toastStore.success('The game has started!');
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
      });

      socket.on(
        WS_EVENTS_OUT.AWAITING_MOVE_CHOICE,
        (_payload: AwaitingMoveChoiceEvent) => {
          this.awaitingMoveChoice = true;
        },
      );

      socket.on(WS_EVENTS_OUT.MOVE_APPLIED, (payload: MoveAppliedEvent) => {
        this.boardState = payload.boardState;
        this.currentTurnSeat = payload.nextTurnSeat;
        this.awaitingMoveChoice = false;
      });

      socket.on(WS_EVENTS_OUT.TURN_SKIPPED, (payload: TurnSkippedEvent) => {
        this.awaitingMoveChoice = false;
        this.isRolling = false;
        this.lastDiceValue = null;
        const name = displayNameForSeat(this.room, payload.seatIndex);
        toastStore.info(`${name}'s turn was skipped (${payload.reason}).`);
      });

      socket.on(WS_EVENTS_OUT.GAME_OVER, (payload: GameOverEvent) => {
        this.winnerSeat = payload.winnerSeat ?? null;
      });

      socket.on(
        WS_EVENTS_OUT.PLAYER_DISCONNECTED,
        (payload: PlayerPresenceEvent) => {
          const name = displayNameForSeat(this.room, payload.seatIndex);
          toastStore.info(`${name} disconnected.`);
        },
      );

      socket.on(
        WS_EVENTS_OUT.PLAYER_RECONNECTED,
        (payload: PlayerPresenceEvent) => {
          const name = displayNameForSeat(this.room, payload.seatIndex);
          toastStore.success(`${name} reconnected.`);
        },
      );

      socket.on(WS_EVENTS_OUT.PLAYER_KICKED, () => {
        toastStore.info('A player was removed from the room.');
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

    resetGameState() {
      this.room = null;
      this.boardState = null;
      this.currentTurnSeat = null;
      this.lastDiceValue = null;
      this.isRolling = false;
      this.awaitingMoveChoice = false;
      this.winnerSeat = null;
    },
  },
});
