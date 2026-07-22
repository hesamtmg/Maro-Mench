import { RoomPlayerStatus } from '../entities/room-player.entity';
import { Room } from '../entities/room.entity';

// Never return full User entities (password hash, etc.) over the wire.
// This is the single place that shapes a Room for HTTP/WS responses.
export function serializeRoomForResponse(room: Room) {
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    visibility: room.visibility,
    maxPlayers: room.maxPlayers,
    rulesJson: room.rulesJson,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    gameType: {
      code: room.gameType.code,
      name: room.gameType.name,
      minPlayers: room.gameType.minPlayers,
      maxPlayers: room.gameType.maxPlayers,
    },
    players: room.players
      .filter(
        (p) =>
          p.status !== RoomPlayerStatus.LEFT &&
          p.status !== RoomPlayerStatus.KICKED,
      )
      .map((p) => ({
        userId: p.userId,
        displayName: p.user?.displayName,
        avatarUrl: p.user?.avatarUrl,
        seatIndex: p.seatIndex,
        color: p.color,
        status: p.status,
        isAdmin: p.isAdmin,
        joinedAt: p.joinedAt,
      })),
  };
}

export function serializeRoomListForResponse(rooms: Room[]) {
  return rooms.map(serializeRoomForResponse);
}
