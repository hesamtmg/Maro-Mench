import { GameResult } from '../entities/game-result.entity';
import { UserGameStats } from '../entities/user-game-stats.entity';

// Never return full User entities (password hash, etc.) over the wire.
export function serializeUserGameStats(stats: UserGameStats) {
  return {
    gameType: {
      code: stats.gameType.code,
      name: stats.gameType.name,
    },
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0,
    updatedAt: stats.updatedAt,
  };
}

export function serializeLeaderboardEntry(stats: UserGameStats, rank: number) {
  return {
    rank,
    userId: stats.userId,
    displayName: stats.user?.displayName,
    avatarUrl: stats.user?.avatarUrl,
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0,
  };
}

export function serializeGameResult(result: GameResult, forUserId: string) {
  const mine = result.players.find((p) => p.userId === forUserId);
  return {
    id: result.id,
    roomId: result.roomId,
    gameType: {
      code: result.gameType.code,
      name: result.gameType.name,
    },
    winner: result.winner
      ? { userId: result.winnerUserId, displayName: result.winner.displayName }
      : null,
    didWin: mine?.isWinner ?? false,
    playerCount: result.players.length,
    finishedAt: result.finishedAt,
  };
}
