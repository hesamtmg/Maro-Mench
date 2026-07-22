import { computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import { useRoomStore } from '../stores/room.store';

export function useMySeat() {
  const authStore = useAuthStore();
  const roomStore = useRoomStore();

  const myPlayer = computed(() =>
    roomStore.room?.players.find((p) => p.userId === authStore.user?.id),
  );

  const isAdmin = computed(() => myPlayer.value?.isAdmin ?? false);

  const isMyTurn = computed(
    () =>
      roomStore.currentTurnSeat !== null &&
      myPlayer.value?.seatIndex === roomStore.currentTurnSeat,
  );

  return { myPlayer, isAdmin, isMyTurn };
}
