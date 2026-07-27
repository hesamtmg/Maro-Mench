import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StatsService } from './stats.service';
import { GameResult } from './entities/game-result.entity';
import { UserGameStats } from './entities/user-game-stats.entity';
import { Room, RoomStatus, RoomVisibility } from '../rooms/entities/room.entity';
import { RoomPlayer, RoomPlayerStatus } from '../rooms/entities/room-player.entity';
import { GameType, GameTypeCode } from '../rooms/entities/game-type.entity';

type MockRepo = {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function createMockRepo(): MockRepo {
  return {
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: 'generated-id', ...entity })),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(),
  };
}

const GAME_TYPE: GameType = {
  id: 5,
  code: GameTypeCode.CONQUEST,
  name: 'Conquest',
  minPlayers: 2,
  maxPlayers: 6,
};

function roomPlayer(
  overrides: Partial<RoomPlayer> & { userId: string; seatIndex: number },
): RoomPlayer {
  return {
    id: `rp-${overrides.userId}`,
    roomId: 'room-1',
    status: RoomPlayerStatus.JOINED,
    color: null,
    isAdmin: false,
    joinedAt: new Date(),
    ...overrides,
  } as RoomPlayer;
}

function room(players: RoomPlayer[], gameTypeId = GAME_TYPE.id): Room {
  return {
    id: 'room-1',
    code: null,
    gameType: GAME_TYPE,
    gameTypeId,
    visibility: RoomVisibility.PUBLIC,
    status: RoomStatus.IN_PROGRESS,
    maxPlayers: 4,
    rulesJson: {},
    players,
    createdAt: new Date(),
  } as Room;
}

describe('StatsService', () => {
  let service: StatsService;
  let gameResultRepo: MockRepo;
  let userGameStatsRepo: MockRepo;

  beforeEach(async () => {
    gameResultRepo = createMockRepo();
    userGameStatsRepo = createMockRepo();

    const module = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: getRepositoryToken(GameResult), useValue: gameResultRepo },
        { provide: getRepositoryToken(UserGameStats), useValue: userGameStatsRepo },
      ],
    }).compile();

    service = module.get(StatsService);
  });

  describe('recordGameResult', () => {
    it('records a GameResult and upserts wins/losses for every seated player', async () => {
      gameResultRepo.findOne.mockResolvedValue(null);
      userGameStatsRepo.findOne.mockResolvedValue(null);

      const r = room([
        roomPlayer({ userId: 'u1', seatIndex: 0 }),
        roomPlayer({ userId: 'u2', seatIndex: 1 }),
      ]);

      await service.recordGameResult(r, 0);

      expect(gameResultRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          gameTypeId: GAME_TYPE.id,
          winnerUserId: 'u1',
          players: [
            { userId: 'u1', seatIndex: 0, isWinner: true },
            { userId: 'u2', seatIndex: 1, isWinner: false },
          ],
        }),
      );

      expect(userGameStatsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', gamesPlayed: 1, wins: 1, losses: 0 }),
      );
      expect(userGameStatsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u2', gamesPlayed: 1, wins: 0, losses: 1 }),
      );
    });

    it('is a no-op if a result for this room already exists', async () => {
      gameResultRepo.findOne.mockResolvedValue({ id: 'existing' });
      const r = room([roomPlayer({ userId: 'u1', seatIndex: 0 })]);

      await service.recordGameResult(r, 0);

      expect(gameResultRepo.save).not.toHaveBeenCalled();
      expect(userGameStatsRepo.save).not.toHaveBeenCalled();
    });

    it('excludes kicked players from the recorded result', async () => {
      gameResultRepo.findOne.mockResolvedValue(null);
      userGameStatsRepo.findOne.mockResolvedValue(null);

      const r = room([
        roomPlayer({ userId: 'u1', seatIndex: 0 }),
        roomPlayer({ userId: 'kicked', seatIndex: 1, status: RoomPlayerStatus.KICKED }),
      ]);

      await service.recordGameResult(r, 0);

      const saved = gameResultRepo.save.mock.calls[0][0];
      expect(saved.players).toEqual([{ userId: 'u1', seatIndex: 0, isWinner: true }]);
    });

    it('treats a null winnerSeat as no winner -- everyone gets a loss', async () => {
      gameResultRepo.findOne.mockResolvedValue(null);
      userGameStatsRepo.findOne.mockResolvedValue(null);

      const r = room([
        roomPlayer({ userId: 'u1', seatIndex: 0 }),
        roomPlayer({ userId: 'u2', seatIndex: 1 }),
      ]);

      await service.recordGameResult(r, null);

      const saved = gameResultRepo.save.mock.calls[0][0];
      expect(saved.winnerUserId).toBeNull();
      expect(saved.players.every((p: { isWinner: boolean }) => !p.isWinner)).toBe(true);
      expect(userGameStatsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', wins: 0, losses: 1 }),
      );
    });

    it('increments an existing stats row instead of overwriting it', async () => {
      gameResultRepo.findOne.mockResolvedValue(null);
      userGameStatsRepo.findOne.mockResolvedValue({
        userId: 'u1',
        gameTypeId: GAME_TYPE.id,
        gamesPlayed: 4,
        wins: 2,
        losses: 2,
      });

      const r = room([roomPlayer({ userId: 'u1', seatIndex: 0 })]);
      await service.recordGameResult(r, 0);

      expect(userGameStatsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', gamesPlayed: 5, wins: 3, losses: 2 }),
      );
    });

    it('does nothing when the room has no seated players', async () => {
      gameResultRepo.findOne.mockResolvedValue(null);
      const r = room([]);

      await service.recordGameResult(r, 0);

      expect(gameResultRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getUserStats', () => {
    it('queries by userId, most-played game type first', async () => {
      await service.getUserStats('u1');
      expect(userGameStatsRepo.find).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        order: { gamesPlayed: 'DESC' },
      });
    });
  });

  describe('getLeaderboard', () => {
    it('queries by gameTypeId, ranked by wins then fewer losses, with the user relation joined', async () => {
      await service.getLeaderboard(GAME_TYPE.id, 10);
      expect(userGameStatsRepo.find).toHaveBeenCalledWith({
        where: { gameTypeId: GAME_TYPE.id },
        relations: { user: true },
        order: { wins: 'DESC', losses: 'ASC' },
        take: 10,
      });
    });
  });

  describe('getUserHistory', () => {
    it('builds a paginated query filtered to the given user and returns results + total', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'gr-1' }], 1]),
      };
      gameResultRepo.createQueryBuilder.mockReturnValue(qb);

      const { results, total } = await service.getUserHistory('u1', 2, 10);

      expect(qb.where).toHaveBeenCalledWith(expect.stringContaining('jsonb_array_elements'), {
        userId: 'u1',
      });
      expect(qb.skip).toHaveBeenCalledWith(10); // (page 2 - 1) * pageSize 10
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(results).toEqual([{ id: 'gr-1' }]);
      expect(total).toBe(1);
    });
  });
});
