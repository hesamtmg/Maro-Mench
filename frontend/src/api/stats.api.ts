import { httpClient } from './http-client';
import type { GameTypeCode } from '../types';

export interface UserGameStatsDto {
  gameType: { code: GameTypeCode; name: string };
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  updatedAt: string;
}

export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface GameResultDto {
  id: string;
  roomId: string;
  gameType: { code: GameTypeCode; name: string };
  winner: { userId: string; displayName: string } | null;
  didWin: boolean;
  playerCount: number;
  finishedAt: string;
}

export const statsApi = {
  getMyStats() {
    return httpClient
      .get<{ stats: UserGameStatsDto[] }>('/stats/me')
      .then((res) => res.data.stats);
  },

  getMyHistory(params: { page?: number; pageSize?: number } = {}) {
    return httpClient
      .get<{ results: GameResultDto[]; total: number; page: number; pageSize: number }>(
        '/stats/me/history',
        { params },
      )
      .then((res) => res.data);
  },

  getLeaderboard(gameTypeCode: GameTypeCode, limit = 20) {
    return httpClient
      .get<{ gameType: { code: GameTypeCode; name: string }; entries: LeaderboardEntryDto[] }>(
        '/stats/leaderboard',
        { params: { gameTypeCode, limit } },
      )
      .then((res) => res.data);
  },
};
