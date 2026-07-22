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
      code:
        params.visibility === RoomVisibility.PRIVATE
          ? await this.generateUniqueCode()
          : null,
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
    if (room.status !== RoomStatus.WAITING) {
      throw new ConflictException('Room is not accepting new players');
    }

    const activePlayers = room.players.filter((p) =>
      [RoomPlayerStatus.JOINED, RoomPlayerStatus.READY].includes(p.status),
    );

    const alreadyIn = activePlayers.find((p) => p.userId === userId);
    if (alreadyIn) {
      return this.findRoomOrThrow(room.id);
    }

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
    const color = isLudo ? LUDO_COLORS[seatIndex] : null;

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
      .andWhere('room.status = :status', { status: RoomStatus.WAITING })
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
