import { Injectable } from '@nestjs/common';

// Manages per-room timers: turn timeouts (skip a stalled player) and
// reconnect grace periods (give a disconnected player time to come back
// before forfeiting their seat / auto-skipping their turns).
@Injectable()
export class RoomSchedulerService {
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  private static readonly TURN_TIMEOUT_MS = 30_000;
  private static readonly DISCONNECT_GRACE_MS = 30_000;

  scheduleTurnTimeout(roomId: string, onTimeout: () => void): void {
    this.clearTurnTimeout(roomId);
    const timer = setTimeout(onTimeout, RoomSchedulerService.TURN_TIMEOUT_MS);
    this.turnTimers.set(roomId, timer);
  }

  clearTurnTimeout(roomId: string): void {
    const existing = this.turnTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.turnTimers.delete(roomId);
    }
  }

  scheduleDisconnectGrace(
    roomId: string,
    userId: string,
    onExpire: () => void,
  ): void {
    const key = `${roomId}:${userId}`;
    this.clearDisconnectGrace(roomId, userId);
    const timer = setTimeout(
      onExpire,
      RoomSchedulerService.DISCONNECT_GRACE_MS,
    );
    this.disconnectTimers.set(key, timer);
  }

  clearDisconnectGrace(roomId: string, userId: string): void {
    const key = `${roomId}:${userId}`;
    const existing = this.disconnectTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.disconnectTimers.delete(key);
    }
  }

  clearAllForRoom(roomId: string): void {
    this.clearTurnTimeout(roomId);
    for (const key of this.disconnectTimers.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(this.disconnectTimers.get(key));
        this.disconnectTimers.delete(key);
      }
    }
  }
}
