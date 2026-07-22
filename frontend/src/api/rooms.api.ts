import { httpClient } from './http-client';
import type { GameTypeCode, Room, RoomVisibility } from '../types';

export const roomsApi = {
  createRoom(data: {
    gameTypeCode: GameTypeCode;
    visibility: Extract<RoomVisibility, 'private' | 'public'>;
    maxPlayers: number;
    rulesJson?: Record<string, unknown>;
  }) {
    return httpClient.post<Room>('/rooms', data).then((res) => res.data);
  },

  listPublicRooms(params: {
    gameTypeCode?: GameTypeCode;
    page?: number;
    pageSize?: number;
  }) {
    return httpClient
      .get<{ rooms: Room[]; total: number; page: number; pageSize: number }>(
        '/rooms',
        { params },
      )
      .then((res) => res.data);
  },

  getRoom(id: string) {
    return httpClient.get<Room>(`/rooms/${id}`).then((res) => res.data);
  },

  joinByCode(code: string) {
    return httpClient
      .post<Room>('/rooms/join-by-code', { code })
      .then((res) => res.data);
  },

  joinById(id: string) {
    return httpClient.post<Room>(`/rooms/${id}/join`).then((res) => res.data);
  },

  leaveRoom(id: string) {
    return httpClient
      .post<Room>(`/rooms/${id}/leave`)
      .then((res) => res.data);
  },

  kickPlayer(roomId: string, targetUserId: string) {
    return httpClient
      .delete<Room>(`/rooms/${roomId}/players/${targetUserId}`)
      .then((res) => res.data);
  },
};
