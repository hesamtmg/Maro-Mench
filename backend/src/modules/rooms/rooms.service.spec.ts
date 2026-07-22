import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { GameTypesService } from './game-types.service';
import { Room, RoomStatus, RoomVisibility } from './entities/room.entity';
import { RoomPlayer, RoomPlayerStatus } from './entities/room-player.entity';
import { GameType, GameTypeCode } from './entities/game-type.entity';

type MockRepo = {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function createMockRepo(): MockRepo {
  return {
    create: jest.fn((data) => data),
    save: jest.fn((entity) =>
      Promise.resolve({ id: 'generated-id', ...entity }),
    ),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  };
}

const LUDO_GAME_TYPE: GameType = {
  id: 1,
  code: GameTypeCode.LUDO,
  name: 'Ludo (منچ)',
  minPlayers: 2,
  maxPlayers: 4,
};

describe('RoomsService', () => {
  let service: RoomsService;
  let roomRepo: MockRepo;
  let roomPlayerRepo: MockRepo;
  let gameTypesService: { findByCode: jest.Mock };

  beforeEach(async () => {
    roomRepo = createMockRepo();
    roomPlayerRepo = createMockRepo();
    gameTypesService = {
      findByCode: jest.fn().mockResolvedValue(LUDO_GAME_TYPE),
    };

    const module = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: getRepositoryToken(Room), useValue: roomRepo },
        { provide: getRepositoryToken(RoomPlayer), useValue: roomPlayerRepo },
        { provide: GameTypesService, useValue: gameTypesService },
      ],
    }).compile();

    service = module.get(RoomsService);
  });

  describe('createRoom', () => {
    it('rejects maxPlayers below the game type minimum', async () => {
      await expect(
        service.createRoom({
          gameTypeCode: GameTypeCode.LUDO,
          visibility: RoomVisibility.PUBLIC,
          maxPlayers: 1,
          createdByUserId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects maxPlayers above the game type maximum', async () => {
      await expect(
        service.createRoom({
          gameTypeCode: GameTypeCode.LUDO,
          visibility: RoomVisibility.PUBLIC,
          maxPlayers: 5,
          createdByUserId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('generates an invite code for private rooms', async () => {
      roomRepo.findOne.mockResolvedValueOnce(null); // uniqueness check passes
      roomRepo.findOne.mockResolvedValueOnce({
        id: 'room-1',
        gameType: LUDO_GAME_TYPE,
        players: [],
      }); // findRoomOrThrow at the end

      await service.createRoom({
        gameTypeCode: GameTypeCode.LUDO,
        visibility: RoomVisibility.PRIVATE,
        maxPlayers: 4,
        createdByUserId: 'user-1',
      });

      const savedRoomCall = roomRepo.save.mock.calls[0][0];
      expect(savedRoomCall.code).toEqual(
        expect.stringMatching(/^[A-Z2-9]{6}$/),
      );
    });

    it('does not generate a code for public rooms', async () => {
      roomRepo.findOne.mockResolvedValueOnce({
        id: 'room-1',
        gameType: LUDO_GAME_TYPE,
        players: [],
      });

      await service.createRoom({
        gameTypeCode: GameTypeCode.LUDO,
        visibility: RoomVisibility.PUBLIC,
        maxPlayers: 4,
        createdByUserId: 'user-1',
      });

      const savedRoomCall = roomRepo.save.mock.calls[0][0];
      expect(savedRoomCall.code).toBeNull();
    });

    it('auto-joins the creator as seat 0 with admin rights', async () => {
      roomRepo.findOne.mockResolvedValueOnce({
        id: 'room-1',
        gameType: LUDO_GAME_TYPE,
        players: [],
      });

      await service.createRoom({
        gameTypeCode: GameTypeCode.LUDO,
        visibility: RoomVisibility.PUBLIC,
        maxPlayers: 4,
        createdByUserId: 'user-1',
      });

      const savedPlayerCall = roomPlayerRepo.save.mock.calls[0][0];
      expect(savedPlayerCall.seatIndex).toBe(0);
      expect(savedPlayerCall.isAdmin).toBe(true);
      expect(savedPlayerCall.color).toBe('red');
    });
  });

  describe('kickPlayer', () => {
    function makeRoom(overrides: Partial<Room> = {}): Room {
      return {
        id: 'room-1',
        visibility: RoomVisibility.PUBLIC,
        gameType: LUDO_GAME_TYPE,
        players: [
          {
            id: 'rp-admin',
            userId: 'admin-user',
            isAdmin: true,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 0,
          } as RoomPlayer,
          {
            id: 'rp-target',
            userId: 'target-user',
            isAdmin: false,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 1,
          } as RoomPlayer,
        ],
        ...overrides,
      } as Room;
    }

    it('allows the admin to kick another player', async () => {
      const room = makeRoom();
      roomRepo.findOne.mockResolvedValue(room);

      await service.kickPlayer('room-1', 'admin-user', 'target-user');

      expect(roomPlayerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'rp-target',
          status: RoomPlayerStatus.KICKED,
        }),
      );
    });

    it('rejects kicking when requester is not the admin', async () => {
      const room = makeRoom();
      roomRepo.findOne.mockResolvedValue(room);

      await expect(
        service.kickPlayer('room-1', 'target-user', 'admin-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects kicking in a matchmaking room regardless of admin status', async () => {
      const room = makeRoom({ visibility: RoomVisibility.MATCHMAKING });
      roomRepo.findOne.mockResolvedValue(room);

      await expect(
        service.kickPlayer('room-1', 'admin-user', 'target-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an admin trying to kick themselves', async () => {
      const room = makeRoom();
      roomRepo.findOne.mockResolvedValue(room);

      await expect(
        service.kickPlayer('room-1', 'admin-user', 'admin-user'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('leaveRoom - admin promotion', () => {
    it('promotes the earliest-seated remaining player when the admin leaves a waiting room', async () => {
      const room = {
        id: 'room-1',
        status: RoomStatus.WAITING,
        players: [
          {
            id: 'rp-admin',
            userId: 'admin-user',
            isAdmin: true,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 0,
          } as RoomPlayer,
          {
            id: 'rp-2',
            userId: 'user-2',
            isAdmin: false,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 2,
          } as RoomPlayer,
          {
            id: 'rp-1',
            userId: 'user-1',
            isAdmin: false,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 1,
          } as RoomPlayer,
        ],
      } as Room;
      roomRepo.findOne.mockResolvedValue(room);

      await service.leaveRoom('room-1', 'admin-user');

      // Seat 1 (user-1) should be promoted, not seat 2, since it has the
      // lower seat index among remaining joined players.
      const promotedCall = roomPlayerRepo.save.mock.calls.find(
        (call: any[]) => call[0].id === 'rp-1',
      );
      expect(promotedCall?.[0].isAdmin).toBe(true);
    });

    it('does not promote anyone if the leaving player was not admin', async () => {
      const room = {
        id: 'room-1',
        status: RoomStatus.WAITING,
        players: [
          {
            id: 'rp-admin',
            userId: 'admin-user',
            isAdmin: true,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 0,
          } as RoomPlayer,
          {
            id: 'rp-1',
            userId: 'user-1',
            isAdmin: false,
            status: RoomPlayerStatus.JOINED,
            seatIndex: 1,
          } as RoomPlayer,
        ],
      } as Room;
      roomRepo.findOne.mockResolvedValue(room);

      await service.leaveRoom('room-1', 'user-1');

      const adminPromotions = roomPlayerRepo.save.mock.calls.filter(
        (call: any[]) => call[0].isAdmin === true && call[0].id !== 'rp-admin',
      );
      expect(adminPromotions).toHaveLength(0);
    });
  });

  describe('joinRoom capacity checks', () => {
    it('rejects joining a full room', async () => {
      const room = {
        id: 'room-1',
        status: RoomStatus.WAITING,
        visibility: RoomVisibility.PUBLIC,
        maxPlayers: 2,
        gameType: LUDO_GAME_TYPE,
        players: [
          {
            userId: 'user-1',
            status: RoomPlayerStatus.JOINED,
            seatIndex: 0,
          } as RoomPlayer,
          {
            userId: 'user-2',
            status: RoomPlayerStatus.JOINED,
            seatIndex: 1,
          } as RoomPlayer,
        ],
      } as Room;
      roomRepo.findOne.mockResolvedValue(room);

      await expect(service.joinRoomById('room-1', 'user-3')).rejects.toThrow(
        ConflictException,
      );
    });

    it('is idempotent when a player already in the room tries to join again', async () => {
      const room = {
        id: 'room-1',
        status: RoomStatus.WAITING,
        visibility: RoomVisibility.PUBLIC,
        maxPlayers: 4,
        gameType: LUDO_GAME_TYPE,
        players: [
          {
            userId: 'user-1',
            status: RoomPlayerStatus.JOINED,
            seatIndex: 0,
          } as RoomPlayer,
        ],
      } as Room;
      roomRepo.findOne.mockResolvedValue(room);

      await service.joinRoomById('room-1', 'user-1');

      // Should not attempt to add a duplicate player row.
      expect(roomPlayerRepo.save).not.toHaveBeenCalled();
    });

    it('rejects joining a private room via joinRoomById', async () => {
      const room = {
        id: 'room-1',
        status: RoomStatus.WAITING,
        visibility: RoomVisibility.PRIVATE,
        maxPlayers: 4,
        gameType: LUDO_GAME_TYPE,
        players: [],
      } as unknown as Room;
      roomRepo.findOne.mockResolvedValue(room);

      await expect(service.joinRoomById('room-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
