import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { useMySeat } from '../useMySeat';
import { useAuthStore } from '../../stores/auth.store';
import { useRoomStore } from '../../stores/room.store';
import type { Room } from '../../types';

// Runs a composable inside a Vue effect scope so its computed() refs stay
// reactive, mirroring how it would behave inside a real component setup().
function withSetup<T>(composable: () => T): T {
  const scope = effectScope();
  return scope.run(composable) as T;
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: null,
    status: 'in_progress',
    visibility: 'public',
    maxPlayers: 4,
    rulesJson: {},
    createdAt: new Date().toISOString(),
    gameType: { code: 'ludo', name: 'Ludo', minPlayers: 2, maxPlayers: 4 },
    players: [
      {
        userId: 'me',
        displayName: 'Me',
        seatIndex: 0,
        status: 'joined',
        isAdmin: true,
        joinedAt: new Date().toISOString(),
      },
      {
        userId: 'other',
        displayName: 'Other',
        seatIndex: 1,
        status: 'joined',
        isAdmin: false,
        joinedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

describe('useMySeat', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('returns undefined myPlayer when there is no room', () => {
    const authStore = useAuthStore();
    authStore.setUser({
      id: 'me',
      email: 'me@example.com',
      phoneNumber: '+1',
      displayName: 'Me',
    });

    const { myPlayer, isAdmin, isMyTurn } = withSetup(() => useMySeat());

    expect(myPlayer.value).toBeUndefined();
    expect(isAdmin.value).toBe(false);
    expect(isMyTurn.value).toBe(false);
  });

  it('finds myPlayer by matching the authenticated userId', () => {
    const authStore = useAuthStore();
    authStore.setUser({
      id: 'me',
      email: 'me@example.com',
      phoneNumber: '+1',
      displayName: 'Me',
    });
    const roomStore = useRoomStore();
    roomStore.room = makeRoom();

    const { myPlayer } = withSetup(() => useMySeat());

    expect(myPlayer.value?.userId).toBe('me');
    expect(myPlayer.value?.seatIndex).toBe(0);
  });

  it('reports isAdmin true only when my seat has isAdmin set', () => {
    const authStore = useAuthStore();
    authStore.setUser({
      id: 'other',
      email: 'other@example.com',
      phoneNumber: '+1',
      displayName: 'Other',
    });
    const roomStore = useRoomStore();
    roomStore.room = makeRoom();

    const { isAdmin } = withSetup(() => useMySeat());

    expect(isAdmin.value).toBe(false);
  });

  it('reports isMyTurn true when currentTurnSeat matches my seatIndex', () => {
    const authStore = useAuthStore();
    authStore.setUser({
      id: 'me',
      email: 'me@example.com',
      phoneNumber: '+1',
      displayName: 'Me',
    });
    const roomStore = useRoomStore();
    roomStore.room = makeRoom();
    roomStore.currentTurnSeat = 0;

    const { isMyTurn } = withSetup(() => useMySeat());

    expect(isMyTurn.value).toBe(true);
  });

  it("reports isMyTurn false when it is someone else's turn", () => {
    const authStore = useAuthStore();
    authStore.setUser({
      id: 'me',
      email: 'me@example.com',
      phoneNumber: '+1',
      displayName: 'Me',
    });
    const roomStore = useRoomStore();
    roomStore.room = makeRoom();
    roomStore.currentTurnSeat = 1;

    const { isMyTurn } = withSetup(() => useMySeat());

    expect(isMyTurn.value).toBe(false);
  });

  it('reports isMyTurn false when currentTurnSeat is null (game not started)', () => {
    const authStore = useAuthStore();
    authStore.setUser({
      id: 'me',
      email: 'me@example.com',
      phoneNumber: '+1',
      displayName: 'Me',
    });
    const roomStore = useRoomStore();
    roomStore.room = makeRoom();
    roomStore.currentTurnSeat = null;

    const { isMyTurn } = withSetup(() => useMySeat());

    expect(isMyTurn.value).toBe(false);
  });
});
