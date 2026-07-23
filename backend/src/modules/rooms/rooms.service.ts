import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameTypeCode } from './entities/game-type.entity';
import { RoomPlayer, RoomPlayerStatus } from './entities/room-player.entity';
import { Room, RoomStatus, RoomVisibility } from './entities/room.entity';
import { GameTypesService } from './game-types.service';
import { generateRoomCode } from './utils/room-code.util';

const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'];

// Per-seat color for game types other than Ludo (which has its own fixed
// four-color convention above). This is a qualitative palette (hues
// spread around the color wheel, not just "different shades of the same
// family") chosen so each seat stays visually distinguishable from every
// other, even when several are on screen at once. Cycled via
// seatIndex % length so larger rooms (e.g. snakes_ladders, up to 16
// players) still get a color per player rather than repeating too
// quickly.
const DEFAULT_SEAT_COLORS = [
  '#e15759', // red
  '#4e79a7', // blue
  '#59a14f', // green
  '#f0b429', // gold
  '#b07aa1', // purple
  '#f28e2b', // orange
  '#17becf', // teal
  '#ff6fae', // pink
];

export interface CreateRoomParams {
  gameTypeCode: GameTypeCode;
  visibility: RoomVisibility.PRIVATE | RoomVisibility.PUBLIC;
  maxPlayers: number;
  rulesJson?: Record<string, unknown>;
  createdByUserId: string;
}

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(RoomPlayer)
    private readonly roomPlayerRepository: Repository<RoomPlayer>,
    private readonly gameTypesService: GameTypesService,
  ) {}

  async createRoom(params: CreateRoomParams): Promise<Room> {
    const gameType = await this.gameTypesService.findByCode(
      params.gameTypeCode,
    );
    if (!gameType) {
      throw new NotFoundException('Unknown game type');
    }

    if (
      params.maxPlayers < gameType.minPlayers ||
      params.maxPlayers > gameType.maxPlayers
    ) {
      throw new BadRequestException(
        `maxPlayers for ${gameType.code} must be between ${gameType.minPlayers} and ${gameType.maxPlayers}`,
      );
    }

    const room = this.roomRepository.create({
      gameTypeId: gameType.id,
      createdById: params.createdByUserId,
      visibility: params.visibility,
      status: RoomStatus.WAITING,
      maxPlayers: params.maxPlayers,
      rulesJson: params.rulesJson ?? {},
      // Every room gets a shareable code, not just private ones -- it's
      // the easiest way for friends to find and land in the *same*
      // public room together, rather than joining whichever public room
      // happens to be first in the list.
      code: await this.generateUniqueCode(),
    });
    const savedRoom = await this.roomRepository.save(room);

    // Creator auto-joins as seat 0 and admin. Pass the game type code we
    // already resolved above — savedRoom.gameType is not populated here
    // since roomRepository.save() doesn't return joined relations.
    await this.addPlayerToRoom(
      savedRoom,
      params.createdByUserId,
      true,
      gameType.code,
    );

    return this.findRoomOrThrow(savedRoom.id);
  }

  async joinRoomByCode(code: string, userId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { code: code.toUpperCase() },
      relations: { players: { user: true } },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return this.joinRoom(room, userId);
  }

  async joinRoomById(roomId: string, userId: string): Promise<Room> {
    const room = await this.findRoomOrThrow(roomId);
    if (room.visibility === RoomVisibility.PRIVATE) {
      throw new ForbiddenException('This room requires an invite code');
    }
    return this.joinRoom(room, userId);
  }

  private async joinRoom(room: Room, userId: string): Promise<Room> {
    // A player who's already seated (including mid-game, via a disconnect
    // or a "leave" while in progress -- see onLeaveRoom in game.gateway.ts)
    // must be able to get back in no matter the room's status; only a
    // stranger needs the room to still be WAITING. The actual JOINED
    // restoration + PLAYER_RECONNECTED broadcast happens in the game
    // gateway's JOIN_ROOM socket handler right after this.
    const existingPlayer = room.players.find((p) => p.userId === userId);
    const isReturningMember =
      existingPlayer &&
      [
        RoomPlayerStatus.JOINED,
        RoomPlayerStatus.READY,
        RoomPlayerStatus.DISCONNECTED,
      ].includes(existingPlayer.status);
    if (isReturningMember) {
      return this.findRoomOrThrow(room.id);
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new ConflictException('Room is not accepting new players');
    }

    const activePlayers = room.players.filter((p) =>
      [RoomPlayerStatus.JOINED, RoomPlayerStatus.READY].includes(p.status),
    );

    if (activePlayers.length >= room.maxPlayers) {
      throw new ConflictException('Room is full');
    }

    await this.addPlayerToRoom(room, userId, false, room.gameType.code);
    return this.findRoomOrThrow(room.id);
  }

  private async addPlayerToRoom(
    room: Room,
    userId: string,
    isAdmin: boolean,
    gameTypeCode: GameTypeCode,
  ): Promise<RoomPlayer> {
    const existingPlayers = await this.roomPlayerRepository.find({
      where: { roomId: room.id },
    });
    const takenSeats = new Set(existingPlayers.map((p) => p.seatIndex));
    let seatIndex = 0;
    while (takenSeats.has(seatIndex)) seatIndex++;

    const isLudo = gameTypeCode === GameTypeCode.LUDO;
    const color = isLudo
      ? LUDO_COLORS[seatIndex]
      : DEFAULT_SEAT_COLORS[seatIndex % DEFAULT_SEAT_COLORS.length];

    const player = this.roomPlayerRepository.create({
      roomId: room.id,
      userId,
      seatIndex,
      color,
      status: RoomPlayerStatus.JOINED,
      isAdmin,
    });
    return this.roomPlayerRepository.save(player);
  }

  async leaveRoom(roomId: string, userId: string): Promise<Room> {
    const room = await this.findRoomOrThrow(roomId);
    const player = room.players.find((p) => p.userId === userId);
    if (!player) {
      throw new NotFoundException('You are not in this room');
    }

    player.status = RoomPlayerStatus.LEFT;
    await this.roomPlayerRepository.save(player);

    // If the admin left a waiting room, promote the next-earliest joined player.
    if (player.isAdmin && room.status === RoomStatus.WAITING) {
      const remaining = room.players
        .filter(
          (p) => p.userId !== userId && p.status === RoomPlayerStatus.JOINED,
        )
        .sort((a, b) => a.seatIndex - b.seatIndex);
      if (remaining.length > 0) {
        remaining[0].isAdmin = true;
        await this.roomPlayerRepository.save(remaining[0]);
      }
    }

    return this.findRoomOrThrow(roomId);
  }

  async kickPlayer(
    roomId: string,
    requestingUserId: string,
    targetUserId: string,
  ): Promise<Room> {
    const room = await this.findRoomOrThrow(roomId);

    if (room.visibility === RoomVisibility.MATCHMAKING) {
      throw new ForbiddenException(
        'Players cannot be kicked from matchmaking rooms',
      );
    }

    const requester = room.players.find((p) => p.userId === requestingUserId);
    if (!requester?.isAdmin) {
      throw new ForbiddenException('Only the room admin can kick players');
    }
    if (requestingUserId === targetUserId) {
      throw new BadRequestException('Admin cannot kick themselves');
    }

    const target = room.players.find((p) => p.userId === targetUserId);
    if (!target) {
      throw new NotFoundException('Player not found in this room');
    }

    target.status = RoomPlayerStatus.KICKED;
    await this.roomPlayerRepository.save(target);

    return this.findRoomOrThrow(roomId);
  }

  /**
   * Deletes a room outright (admin only). RoomPlayer/GameState/GameMove
   * rows all have an ON DELETE CASCADE FK to rooms, so a single delete
   * here cleans up everything -- no manual child-row removal needed.
   */
  async deleteRoom(roomId: string, requestingUserId: string): Promise<Room> {
    const room = await this.findRoomOrThrow(roomId);

    const requester = room.players.find((p) => p.userId === requestingUserId);
    if (!requester?.isAdmin) {
      throw new ForbiddenException('Only the room admin can delete the room');
    }

    await this.roomRepository.delete({ id: roomId });
    return room;
  }

  /**
   * Converts a freshly-created room into a matchmaking room: strips
   * admin rights from every seat (matchmaking rooms have no kick power)
   * and clears createdBy since it's system-formed, not user-created.
   */
  async convertToMatchmakingRoom(roomId: string): Promise<void> {
    await this.roomRepository.update(
      { id: roomId },
      { visibility: RoomVisibility.MATCHMAKING, createdById: null },
    );
    await this.roomPlayerRepository.update({ roomId }, { isAdmin: false });
  }

  async markPlayerStatus(
    roomPlayerId: string,
    status: RoomPlayerStatus,
  ): Promise<void> {
    await this.roomPlayerRepository.update({ id: roomPlayerId }, { status });
  }

  async listPublicRooms(
    gameTypeCode: GameTypeCode | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ rooms: Room[]; total: number }> {
    const qb = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.players', 'players')
      .leftJoinAndSelect('room.gameType', 'gameType')
      .where('room.visibility = :visibility', {
        visibility: RoomVisibility.PUBLIC,
      })
      // Include in-progress rooms too, not just WAITING ones -- otherwise
      // a player who left (or disconnected) mid-game has no way to find
      // their way back to it without already having the room code saved.
      // Strangers can still see it, but joinRoom() only lets an existing
      // member actually back into a non-WAITING room.
      .andWhere('room.status IN (:...statuses)', {
        statuses: [RoomStatus.WAITING, RoomStatus.IN_PROGRESS],
      })
      .orderBy('room.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (gameTypeCode) {
      qb.andWhere('gameType.code = :code', { code: gameTypeCode });
    }

    const [rooms, total] = await qb.getManyAndCount();
    return { rooms, total };
  }

  async findRoomOrThrow(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: { players: { user: true }, gameType: true },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }

  private async generateUniqueCode(): Promise<string> {
    let code: string;
    let existing: Room | null;
    do {
      code = generateRoomCode();
      existing = await this.roomRepository.findOne({ where: { code } });
    } while (existing);
    return code;
  }
}
