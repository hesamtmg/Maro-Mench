export type GameTypeCode = 'ludo' | 'snakes_ladders';

export interface GameType {
  code: GameTypeCode;
  name: string;
  minPlayers: number;
  maxPlayers: number;
}

export type RoomVisibility = 'private' | 'public' | 'matchmaking';
export type RoomStatus = 'waiting' | 'in_progress' | 'finished' | 'abandoned';
export type RoomPlayerStatus =
  | 'joined'
  | 'ready'
  | 'left'
  | 'disconnected'
  | 'kicked';

export interface RoomPlayer {
  userId: string;
  displayName?: string;
  avatarUrl?: string | null;
  seatIndex: number;
  color?: string | null;
  status: RoomPlayerStatus;
  isAdmin: boolean;
  joinedAt: string;
}

export interface Room {
  id: string;
  code?: string | null;
  status: RoomStatus;
  visibility: RoomVisibility;
  maxPlayers: number;
  rulesJson: Record<string, unknown>;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  gameType: GameType;
  players: RoomPlayer[];
}

export interface AuthUser {
  id: string;
  email: string;
  phoneNumber: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}
