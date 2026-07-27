import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoomPlayerStatus } from '../rooms/entities/room-player.entity';
import { Room } from '../rooms/entities/room.entity';
import { GameResult, GameResultPlayer } from './entities/game-result.entity';
import { UserGameStats } from './entities/user-game-stats.entity';

// Anyone who was ever actually seated for the game, even if they later
// disconnected or left before it ended -- excludes only players kicked
// before/without ever taking a seat in the finished game.
const SEATED_STATUSES = [
  RoomPlayerStatus.JOINED,
  RoomPlayerStatus.READY,
  RoomPlayerStatus.DISCONNECTED,
  RoomPlayerStatus.LEFT,
];

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(GameResult)
    private readonly gameResultRepository: Repository<GameResult>,
    @InjectRepository(UserGameStats)
    private readonly userGameStatsRepository: Repository<UserGameStats>,
  ) {}

  /**
   * Records the outcome of a just-finished game: one GameResult row, plus
   * an updated UserGameStats row for every seated player. Idempotent per
   * room (a room can only finish once, but this guards against a retried
   * or duplicated finishGame call double-counting a result).
   */
  async recordGameResult(room: Room, winnerSeat: number | null): Promise<void> {
    const existing = await this.gameResultRepository.findOne({
      where: { roomId: room.id },
    });
    if (existing) return;

    const seated = room.players.filter((p) => SEATED_STATUSES.includes(p.status));
    if (seated.length === 0) return;

    const winnerPlayer =
      winnerSeat != null ? seated.find((p) => p.seatIndex === winnerSeat) : undefined;

    const players: GameResultPlayer[] = seated.map((p) => ({
      userId: p.userId,
      seatIndex: p.seatIndex,
      isWinner: winnerPlayer != null && p.userId === winnerPlayer.userId,
    }));

    const result = this.gameResultRepository.create({
      roomId: room.id,
      gameTypeId: room.gameTypeId,
      winnerUserId: winnerPlayer?.userId ?? null,
      players,
      finishedAt: new Date(),
    });
    await this.gameResultRepository.save(result);

    for (const p of players) {
      await this.upsertStats(p.userId, room.gameTypeId, p.isWinner);
    }
  }

  private async upsertStats(
    userId: string,
    gameTypeId: number,
    isWinner: boolean,
  ): Promise<void> {
    let stats = await this.userGameStatsRepository.findOne({
      where: { userId, gameTypeId },
    });
    if (!stats) {
      stats = this.userGameStatsRepository.create({
        userId,
        gameTypeId,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
      });
    }
    stats.gamesPlayed += 1;
    if (isWinner) stats.wins += 1;
    else stats.losses += 1;
    await this.userGameStatsRepository.save(stats);
  }

  /** All of a user's per-game-type stats, most-played game type first. */
  getUserStats(userId: string): Promise<UserGameStats[]> {
    return this.userGameStatsRepository.find({
      where: { userId },
      order: { gamesPlayed: 'DESC' },
    });
  }

  /** Top players for one game type, ranked by wins (ties broken by fewer losses). */
  getLeaderboard(gameTypeId: number, limit: number): Promise<UserGameStats[]> {
    return this.userGameStatsRepository.find({
      where: { gameTypeId },
      relations: { user: true },
      order: { wins: 'DESC', losses: 'ASC' },
      take: limit,
    });
  }

  /** A user's past finished games, most recent first. */
  async getUserHistory(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ results: GameResult[]; total: number }> {
    const [results, total] = await this.gameResultRepository
      .createQueryBuilder('gr')
      .leftJoinAndSelect('gr.gameType', 'gameType')
      .leftJoinAndSelect('gr.winner', 'winner')
      .where(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(gr.players) elem WHERE elem->>'userId' = :userId)`,
        { userId },
      )
      .orderBy('gr.finishedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { results, total };
  }
}
