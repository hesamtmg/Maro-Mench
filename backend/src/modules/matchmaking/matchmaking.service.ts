import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameTypeCode } from '../rooms/entities/game-type.entity';
import { RoomVisibility } from '../rooms/entities/room.entity';
import { GameTypesService } from '../rooms/game-types.service';
import { RoomsService } from '../rooms/rooms.service';
import {
  MatchmakingTicket,
  MatchmakingTicketStatus,
} from './entities/matchmaking-ticket.entity';
import { hashRules } from './utils/hash-rules.util';

interface QueueEntry {
  ticketId: string;
  userId: string;
  joinedAt: number;
}

interface QueueBucket {
  gameTypeCode: GameTypeCode;
  rulesJson: Record<string, unknown>;
  entries: QueueEntry[];
  fillTimer?: NodeJS.Timeout;
}

export interface MatchFoundEvent {
  userIds: string[];
  roomId: string;
}

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  // bucketKey (gameTypeCode + rulesHash) -> queue bucket
  private buckets = new Map<string, QueueBucket>();

  // Callback the gateway registers to be notified when a match forms,
  // so it can push `match_found` over the socket to each matched user.
  private onMatchFoundCallback?: (event: MatchFoundEvent) => void;

  private readonly fillWaitMs: number;

  constructor(
    @InjectRepository(MatchmakingTicket)
    private readonly ticketRepository: Repository<MatchmakingTicket>,
    private readonly roomsService: RoomsService,
    private readonly gameTypesService: GameTypesService,
    private readonly configService: ConfigService,
  ) {
    this.fillWaitMs = parseInt(
      this.configService.get<string>('MATCHMAKING_FILL_WAIT_MS') ?? '15000',
      10,
    );
  }

  onMatchFound(callback: (event: MatchFoundEvent) => void): void {
    this.onMatchFoundCallback = callback;
  }

  async joinQueue(
    userId: string,
    gameTypeCode: GameTypeCode,
    rulesJson: Record<string, unknown> = {},
  ): Promise<{ ticketId: string }> {
    // A user should only have one active ticket at a time.
    const existing = await this.ticketRepository.findOne({
      where: { userId, status: MatchmakingTicketStatus.QUEUED },
    });
    if (existing) {
      return { ticketId: existing.id };
    }

    const gameType = await this.gameTypesService.findByCode(gameTypeCode);
    if (!gameType) {
      throw new Error('Unknown game type');
    }

    const ticket = this.ticketRepository.create({
      userId,
      gameTypeId: gameType.id,
      rulesJson,
      status: MatchmakingTicketStatus.QUEUED,
    });
    const saved = await this.ticketRepository.save(ticket);

    const bucketKey = this.bucketKey(gameTypeCode, rulesJson);
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { gameTypeCode, rulesJson, entries: [] };
      this.buckets.set(bucketKey, bucket);
    }
    bucket.entries.push({
      ticketId: saved.id,
      userId,
      joinedAt: Date.now(),
    });

    this.logger.log(
      `User ${userId} queued for ${gameTypeCode} (bucket size: ${bucket.entries.length})`,
    );

    await this.tryFormMatch(
      bucketKey,
      gameType.minPlayers,
      gameType.maxPlayers,
    );

    return { ticketId: saved.id };
  }

  async cancelQueue(userId: string): Promise<void> {
    const ticket = await this.ticketRepository.findOne({
      where: { userId, status: MatchmakingTicketStatus.QUEUED },
    });
    if (!ticket) return;

    ticket.status = MatchmakingTicketStatus.CANCELLED;
    await this.ticketRepository.save(ticket);

    for (const bucket of this.buckets.values()) {
      const idx = bucket.entries.findIndex((e) => e.ticketId === ticket.id);
      if (idx !== -1) {
        bucket.entries.splice(idx, 1);
        if (bucket.entries.length === 0 && bucket.fillTimer) {
          clearTimeout(bucket.fillTimer);
          bucket.fillTimer = undefined;
        }
        break;
      }
    }
  }

  private async tryFormMatch(
    bucketKey: string,
    minPlayers: number,
    maxPlayers: number,
  ): Promise<void> {
    const bucket = this.buckets.get(bucketKey);
    if (!bucket) return;

    if (bucket.entries.length >= maxPlayers) {
      // Enough to fill the room completely — match immediately, no need to wait.
      if (bucket.fillTimer) {
        clearTimeout(bucket.fillTimer);
        bucket.fillTimer = undefined;
      }
      await this.formMatch(bucketKey, maxPlayers);
      return;
    }

    if (bucket.entries.length >= minPlayers && !bucket.fillTimer) {
      // Enough to start, but give it a short window to fill up further
      // before settling for the minimum, per product decision.
      bucket.fillTimer = setTimeout(() => {
        void this.formMatch(bucketKey, maxPlayers);
      }, this.fillWaitMs);
    }
  }

  private async formMatch(
    bucketKey: string,
    maxPlayers: number,
  ): Promise<void> {
    const bucket = this.buckets.get(bucketKey);
    if (!bucket) return;
    bucket.fillTimer = undefined;

    const gameType = await this.gameTypesService.findByCode(
      bucket.gameTypeCode,
    );
    if (!gameType || bucket.entries.length < gameType.minPlayers) {
      return; // someone cancelled out from under us; not enough left
    }

    const takeCount = Math.min(bucket.entries.length, maxPlayers);
    const matchedEntries = bucket.entries.splice(0, takeCount);

    const room = await this.roomsService.createRoom({
      gameTypeCode: bucket.gameTypeCode,
      visibility: RoomVisibility.PUBLIC, // internally reused, converted below
      maxPlayers: takeCount,
      rulesJson: bucket.rulesJson,
      createdByUserId: matchedEntries[0].userId,
    });

    // Convert to a proper matchmaking room: no admin/kick powers, then join
    // the remaining matched players.
    await this.roomsService.convertToMatchmakingRoom(room.id);
    for (const entry of matchedEntries.slice(1)) {
      await this.roomsService.joinRoomById(room.id, entry.userId);
    }

    for (const entry of matchedEntries) {
      await this.ticketRepository.update(
        { id: entry.ticketId },
        { status: MatchmakingTicketStatus.MATCHED, matchedRoomId: room.id },
      );
    }

    this.logger.log(
      `Formed match for ${bucket.gameTypeCode}: room ${room.id} with ${matchedEntries.length} players`,
    );

    this.onMatchFoundCallback?.({
      userIds: matchedEntries.map((e) => e.userId),
      roomId: room.id,
    });
  }

  private bucketKey(
    gameTypeCode: GameTypeCode,
    rulesJson: Record<string, unknown>,
  ): string {
    return `${gameTypeCode}:${hashRules(rulesJson)}`;
  }
}
