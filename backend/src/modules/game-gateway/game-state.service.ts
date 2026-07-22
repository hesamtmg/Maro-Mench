import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameEngineFactory } from '../game-engine/game-engine.factory';
import { RoomPlayerSeat } from '../game-engine/game-engine.interface';
import { GameMove } from '../rooms/entities/game-move.entity';
import { GameState } from '../rooms/entities/game-state.entity';
import {
  RoomPlayer,
  RoomPlayerStatus,
} from '../rooms/entities/room-player.entity';
import { Room, RoomStatus } from '../rooms/entities/room.entity';

@Injectable()
export class GameStateService {
  constructor(
    @InjectRepository(GameState)
    private readonly gameStateRepository: Repository<GameState>,
    @InjectRepository(GameMove)
    private readonly gameMoveRepository: Repository<GameMove>,
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(RoomPlayer)
    private readonly roomPlayerRepository: Repository<RoomPlayer>,
    private readonly gameEngineFactory: GameEngineFactory,
  ) {}

  toSeats(players: RoomPlayer[]): RoomPlayerSeat[] {
    return players
      .filter((p) =>
        [
          RoomPlayerStatus.JOINED,
          RoomPlayerStatus.READY,
          RoomPlayerStatus.DISCONNECTED,
        ].includes(p.status),
      )
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => ({
        seatIndex: p.seatIndex,
        userId: p.userId,
        color: p.color,
      }));
  }

  async startGame(room: Room): Promise<GameState> {
    const seats = this.toSeats(room.players);
    const engine = this.gameEngineFactory.getEngine(room.gameType.code);
    const initialBoardState = engine.createInitialState(seats, room.rulesJson);

    const gameState = this.gameStateRepository.create({
      roomId: room.id,
      currentTurnSeat: seats[0]?.seatIndex ?? 0,
      boardState: initialBoardState,
      turnNumber: 0,
      lastRoll: null,
    });
    const saved = await this.gameStateRepository.save(gameState);

    room.status = RoomStatus.IN_PROGRESS;
    room.startedAt = new Date();
    await this.roomRepository.save(room);

    return saved;
  }

  async getGameState(roomId: string): Promise<GameState> {
    const state = await this.gameStateRepository.findOne({
      where: { roomId },
    });
    if (!state) {
      throw new NotFoundException('Game has not started for this room');
    }
    return state;
  }

  async recordMove(
    roomId: string,
    seatIndex: number,
    diceValue: number | null,
    movePayload: Record<string, unknown>,
  ): Promise<void> {
    const lastMove = await this.gameMoveRepository.findOne({
      where: { roomId },
      order: { moveNumber: 'DESC' },
    });
    const moveNumber = (lastMove?.moveNumber ?? -1) + 1;

    const move = this.gameMoveRepository.create({
      roomId,
      seatIndex,
      moveNumber,
      diceValue,
      movePayload,
    });
    await this.gameMoveRepository.save(move);
  }

  async updateGameState(
    gameState: GameState,
    updates: Partial<
      Pick<GameState, 'boardState' | 'currentTurnSeat' | 'lastRoll'>
    >,
  ): Promise<GameState> {
    Object.assign(gameState, updates);
    gameState.turnNumber += 1;
    return this.gameStateRepository.save(gameState);
  }

  async finishGame(roomId: string): Promise<void> {
    await this.roomRepository.update(
      { id: roomId },
      { status: RoomStatus.FINISHED, finishedAt: new Date() },
    );
  }
}
