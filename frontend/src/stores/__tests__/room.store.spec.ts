import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useRoomStore } from '../room.store';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from '../../api/ws-events.constants';
import type { Room } from '../../types';

// A minimal fake Socket.io client: supports on/off/emit and lets tests
// trigger server->client events synchronously to drive the store.
class FakeSocket {
  handlers = new Map<string, Array<(payload: unknown) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, handler: (payload: unknown) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: string) {
    this.handlers.delete(event);
  }

  emit(event: string, payload: unknown) {
    this.emitted.push({ event, payload });
  }

  // Test helper: simulate the server pushing an event to this client.
  trigger(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  get connected() {
    return true;
  }
  connect() {
    return this;
  }
  disconnect() {
    return this;
  }
}

const fakeSocket = new FakeSocket();

vi.mock('../../api/socket.client', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
  disconnectSocket: vi.fn(),
}));

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: null,
    status: 'waiting',
    visibility: 'public',
    maxPlayers: 4,
    rulesJson: {},
    createdAt: new Date().toISOString(),
    gameType: { code: 'ludo', name: 'Ludo', minPlayers: 2, maxPlayers: 4 },
    players: [
      {
        userId: 'user-1',
        displayName: 'Alice',
        seatIndex: 0,
        status: 'joined',
        isAdmin: true,
        joinedAt: new Date().toISOString(),
      },
      {
        userId: 'user-2',
        displayName: 'Bob',
        seatIndex: 1,
        status: 'joined',
        isAdmin: false,
        joinedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

describe('room store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fakeSocket.emitted = [];
    fakeSocket.handlers = new Map();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('emitting actions', () => {
    it('emits join_room with the given roomId', () => {
      const store = useRoomStore();
      store.connect();
      store.joinRoom('room-1');

      expect(fakeSocket.emitted).toContainEqual({
        event: WS_EVENTS_IN.JOIN_ROOM,
        payload: { roomId: 'room-1' },
      });
    });

    it('emits roll_dice and sets isRolling optimistically', () => {
      const store = useRoomStore();
      store.connect();
      store.rollDice('room-1');

      expect(store.isRolling).toBe(true);
      expect(fakeSocket.emitted).toContainEqual({
        event: WS_EVENTS_IN.ROLL_DICE,
        payload: { roomId: 'room-1' },
      });
    });

    it('emits make_move with the chosen tokenId', () => {
      const store = useRoomStore();
      store.connect();
      store.makeMove('room-1', 2);

      expect(fakeSocket.emitted).toContainEqual({
        event: WS_EVENTS_IN.MAKE_MOVE,
        payload: { roomId: 'room-1', tokenId: 2 },
      });
    });

    it('resets game state locally when leaving a room', () => {
      const store = useRoomStore();
      store.connect();
      store.room = makeRoom();
      store.boardState = { tokens: {} };
      store.currentTurnSeat = 0;

      store.leaveRoom('room-1');

      expect(store.room).toBeNull();
      expect(store.boardState).toBeNull();
      expect(store.currentTurnSeat).toBeNull();
    });
  });

  describe('handling incoming events', () => {
    it('updates room on room_state', () => {
      const store = useRoomStore();
      store.connect();
      const room = makeRoom();

      fakeSocket.trigger(WS_EVENTS_OUT.ROOM_STATE, room);

      expect(store.room).toEqual(room);
    });

    it('sets board state and turn on game_started', () => {
      const store = useRoomStore();
      store.connect();

      fakeSocket.trigger(WS_EVENTS_OUT.GAME_STARTED, {
        boardState: { tokens: { 0: [] } },
        currentTurnSeat: 0,
      });

      expect(store.boardState).toEqual({ tokens: { 0: [] } });
      expect(store.currentTurnSeat).toBe(0);
      expect(store.winnerSeat).toBeNull();
    });

    it('sets lastDiceValue and clears isRolling after the roll animation delay', () => {
      const store = useRoomStore();
      store.connect();
      store.isRolling = true;

      fakeSocket.trigger(WS_EVENTS_OUT.DICE_ROLLED, {
        seatIndex: 0,
        diceValue: 4,
      });

      // Value shouldn't be applied immediately (animation delay).
      expect(store.lastDiceValue).toBeNull();

      vi.advanceTimersByTime(500);

      expect(store.lastDiceValue).toBe(4);
      expect(store.isRolling).toBe(false);
    });

    it('sets awaitingMoveChoice on awaiting_move_choice', () => {
      const store = useRoomStore();
      store.connect();

      fakeSocket.trigger(WS_EVENTS_OUT.AWAITING_MOVE_CHOICE, {
        seatIndex: 0,
        diceValue: 6,
      });

      expect(store.awaitingMoveChoice).toBe(true);
    });

    it('updates board state and turn on move_applied', () => {
      const store = useRoomStore();
      store.connect();
      store.awaitingMoveChoice = true;

      fakeSocket.trigger(WS_EVENTS_OUT.MOVE_APPLIED, {
        seatIndex: 0,
        boardState: { tokens: { 0: [{ tokenId: 0, position: 5 }] } },
        nextTurnSeat: 1,
        movePayload: {},
      });

      expect(store.boardState).toEqual({
        tokens: { 0: [{ tokenId: 0, position: 5 }] },
      });
      expect(store.currentTurnSeat).toBe(1);
      expect(store.awaitingMoveChoice).toBe(false);
    });

    it('clears rolling/awaiting state on turn_skipped', () => {
      const store = useRoomStore();
      store.connect();
      store.room = makeRoom();
      store.isRolling = true;
      store.awaitingMoveChoice = true;

      fakeSocket.trigger(WS_EVENTS_OUT.TURN_SKIPPED, {
        seatIndex: 0,
        reason: 'timeout',
        nextTurnSeat: 1,
      });

      expect(store.isRolling).toBe(false);
      expect(store.awaitingMoveChoice).toBe(false);
      expect(store.lastDiceValue).toBeNull();
      expect(store.currentTurnSeat).toBe(1);
    });

    it('sets winnerSeat on game_over', () => {
      const store = useRoomStore();
      store.connect();

      fakeSocket.trigger(WS_EVENTS_OUT.GAME_OVER, { winnerSeat: 1 });

      expect(store.winnerSeat).toBe(1);
    });

    it('clears isRolling when an error_event arrives', () => {
      const store = useRoomStore();
      store.connect();
      store.isRolling = true;

      fakeSocket.trigger(WS_EVENTS_OUT.ERROR, {
        message: 'It is not your turn',
      });

      expect(store.isRolling).toBe(false);
    });

    it('only binds listeners once even if connect() is called multiple times', () => {
      const store = useRoomStore();
      store.connect();
      store.connect();
      store.connect();

      expect(fakeSocket.handlers.get(WS_EVENTS_OUT.GAME_OVER)).toHaveLength(
        1,
      );
    });
  });
});
