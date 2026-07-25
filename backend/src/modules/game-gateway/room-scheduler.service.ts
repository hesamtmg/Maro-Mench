import { Injectable } from '@nestjs/common';

// Manages per-room timers: turn timeouts (skip a stalled player) and
// reconnect grace periods (give a disconnected player time to come back
// before forfeiting their seat / auto-skipping their turns).
@Injectable()
export class RoomSchedulerService {
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  // Epoch ms when each room's active turn timer will fire, tracked
  // alongside the timer itself so a pause can compute how much time was
  // actually left instead of always resuming with a full fresh timeout.
  private turnDeadlines = new Map<string, number>();
  // Presence in this map means the room is paused; the value is how many
  // ms were left on the turn timer at the moment it was paused.
  private pausedRooms = new Map<string, number>();

  private static readonly TURN_TIMEOUT_MS = 30_000;
  private static readonly DISCONNECT_GRACE_MS = 30_000;

  scheduleTurnTimeout(
    roomId: string,
    onTimeout: () => void,
    durationMs: number = RoomSchedulerService.TURN_TIMEOUT_MS,
  ): void {
    this.clearTurnTimeout(roomId);
    const timer = setTimeout(onTimeout, durationMs);
    this.turnTimers.set(roomId, timer);
    this.turnDeadlines.set(roomId, Date.now() + durationMs);
  }

  clearTurnTimeout(roomId: string): void {
    const existing = this.turnTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.turnTimers.delete(roomId);
    }
    this.turnDeadlines.delete(roomId);
  }

  isPaused(roomId: string): boolean {
    return this.pausedRooms.has(roomId);
  }

  // Freezes the room's turn timer, remembering how much time was left so
  // resumeRoom() can pick up where it left off instead of granting a full
  // fresh 30s. Returns the remaining ms (mostly useful for logging/tests).
  pauseRoom(roomId: string): number {
    const deadline = this.turnDeadlines.get(roomId);
    const remaining =
      deadline != null
        ? Math.max(0, deadline - Date.now())
        : RoomSchedulerService.TURN_TIMEOUT_MS;
    this.clearTurnTimeout(roomId);
    this.pausedRooms.set(roomId, remaining);
    return remaining;
  }

  // Reschedules the turn timer for whatever time was left when paused,
  // and returns that remaining ms so the caller can broadcast the real
  // new deadline to clients.
  resumeRoom(roomId: string, onTimeout: () => void): number {
    const remaining =
      this.pausedRooms.get(roomId) ?? RoomSchedulerService.TURN_TIMEOUT_MS;
    this.pausedRooms.delete(roomId);
    this.scheduleTurnTimeout(roomId, onTimeout, remaining);
    return remaining;
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
    this.pausedRooms.delete(roomId);
    for (const key of this.disconnectTimers.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(this.disconnectTimers.get(key));
        this.disconnectTimers.delete(key);
      }
    }
  }
}
