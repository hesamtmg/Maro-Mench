import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { GameEngineFactory } from '../game-engine/game-engine.factory';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { GameTypeCode } from '../rooms/entities/game-type.entity';
import { RoomPlayerStatus } from '../rooms/entities/room-player.entity';
import {
  Room,
  RoomStatus,
  RoomVisibility,
} from '../rooms/entities/room.entity';
import { RoomsService } from '../rooms/rooms.service';
import { serializeRoomForResponse } from '../rooms/serializers/room.serializer';
import { GameStateService } from './game-state.service';
import { RoomSchedulerService } from './room-scheduler.service';
import { authenticateSocket } from './ws-auth.util';
import type { AuthenticatedSocket } from './ws-auth.util';
import { WS_EVENTS_IN, WS_EVENTS_OUT } from './ws-events.constants';

interface RoomIdPayload {
  roomId: string;
}

interface MakeMovePayload {
  roomId: string;
  tokenId: number;
}

interface KickPayload {
  roomId: string;
  targetUserId: string;
}

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' },
  namespace: '/game',
})
export class GameGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);

  // socket.id -> roomId, for cleanup on disconnect
  private socketToRoom = new Map<string, string>();

  // userId -> socket.id, so we can push match_found / queue events directly
  // to a specific user regardless of which room (if any) they're in.
  private userToSocket = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly roomsService: RoomsService,
    private readonly gameStateService: GameStateService,
    private readonly gameEngineFactory: GameEngineFactory,
    private readonly scheduler: RoomSchedulerService,
    private readonly matchmakingService: MatchmakingService,
  ) {}

  onModuleInit() {
    this.matchmakingService.onMatchFound(({ userIds, roomId }) => {
      for (const userId of userIds) {
        const socketId = this.userToSocket.get(userId);
        if (socketId) {
          this.server.to(socketId).emit(WS_EVENTS_OUT.MATCH_FOUND, { roomId });
        }
      }
    });
  }

  async handleConnection(socket: AuthenticatedSocket) {
    try {
      const auth = await authenticateSocket(
        socket,
        this.jwtService,
        this.configService,
      );
      socket.data.userId = auth.userId;
      socket.data.email = auth.email;
      this.userToSocket.set(auth.userId, socket.id);
    } catch (err) {
      this.logger.warn(`Socket auth failed: ${(err as Error).message}`);
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'Authentication failed' });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AuthenticatedSocket) {
    if (socket.data?.userId) {
      this.userToSocket.delete(socket.data.userId);
    }
    const roomId = this.socketToRoom.get(socket.id);
    this.socketToRoom.delete(socket.id);
    if (!roomId || !socket.data?.userId) return;

    try {
      const room = await this.roomsService.findRoomOrThrow(roomId);
      const player = room.players.find((p) => p.userId === socket.data.userId);
      if (!player) return;

      if (room.status === RoomStatus.IN_PROGRESS) {
        // Mark disconnected; the active turn-timeout (if it's their turn)
        // will auto-skip them when it fires.
        await this.roomsService.markPlayerStatus(
          player.id,
          RoomPlayerStatus.DISCONNECTED,
        );

        this.server.to(roomId).emit(WS_EVENTS_OUT.PLAYER_DISCONNECTED, {
          userId: socket.data.userId,
          seatIndex: player.seatIndex,
        });
      } else if (room.status === RoomStatus.WAITING) {
        // Leaving the lobby before the game starts frees their seat.
        await this.roomsService.leaveRoom(roomId, socket.data.userId);
        const updatedRoom = await this.roomsService.findRoomOrThrow(roomId);
        this.broadcastRoomState(updatedRoom);
        if (updatedRoom.visibility === RoomVisibility.PUBLIC) {
          this.server.emit(WS_EVENTS_OUT.ROOM_LIST_UPDATED, {
            roomId: updatedRoom.id,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Error handling disconnect: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.JOIN_ROOM)
  async onJoinRoom(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, {
        message: 'You are not a member of this room',
      });
      return;
    }

    void socket.join(payload.roomId);
    this.socketToRoom.set(socket.id, payload.roomId);

    // Reconnect handling: if they were marked disconnected, restore them.
    if (player.status === RoomPlayerStatus.DISCONNECTED) {
      await this.roomsService.markPlayerStatus(
        player.id,
        RoomPlayerStatus.JOINED,
      );
      this.server.to(payload.roomId).emit(WS_EVENTS_OUT.PLAYER_RECONNECTED, {
        userId: socket.data.userId,
        seatIndex: player.seatIndex,
      });
    }

    const refreshedRoom = await this.roomsService.findRoomOrThrow(
      payload.roomId,
    );
    socket.emit(
      WS_EVENTS_OUT.ROOM_STATE,
      serializeRoomForResponse(refreshedRoom),
    );

    if (refreshedRoom.status === RoomStatus.IN_PROGRESS) {
      const gameState = await this.gameStateService.getGameState(
        payload.roomId,
      );
      socket.emit(WS_EVENTS_OUT.GAME_STARTED, {
        boardState: gameState.boardState,
        currentTurnSeat: gameState.currentTurnSeat,
      });
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.LEAVE_ROOM)
  async onLeaveRoom(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    void socket.leave(payload.roomId);
    this.socketToRoom.delete(socket.id);

    const room = await this.roomsService.leaveRoom(
      payload.roomId,
      socket.data.userId,
    );
    this.broadcastRoomState(room);
    this.server.to(payload.roomId).emit(WS_EVENTS_OUT.PLAYER_LEFT, {
      userId: socket.data.userId,
    });
    if (room.visibility === RoomVisibility.PUBLIC) {
      this.server.emit(WS_EVENTS_OUT.ROOM_LIST_UPDATED, { roomId: room.id });
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.KICK_PLAYER)
  async onKickPlayer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: KickPayload,
  ) {
    try {
      const room = await this.roomsService.kickPlayer(
        payload.roomId,
        socket.data.userId,
        payload.targetUserId,
      );
      this.broadcastRoomState(room);
      this.server.to(payload.roomId).emit(WS_EVENTS_OUT.PLAYER_KICKED, {
        userId: payload.targetUserId,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.JOIN_QUEUE)
  async onJoinQueue(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody()
    payload: {
      gameTypeCode: GameTypeCode;
      rulesJson?: Record<string, unknown>;
    },
  ) {
    try {
      const { ticketId } = await this.matchmakingService.joinQueue(
        socket.data.userId,
        payload.gameTypeCode,
        payload.rulesJson ?? {},
      );
      socket.emit(WS_EVENTS_OUT.QUEUE_JOINED, { ticketId });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.CANCEL_QUEUE)
  async onCancelQueue(@ConnectedSocket() socket: AuthenticatedSocket) {
    await this.matchmakingService.cancelQueue(socket.data.userId);
    socket.emit(WS_EVENTS_OUT.QUEUE_CANCELLED, {});
  }

  @SubscribeMessage(WS_EVENTS_IN.START_GAME)
  async onStartGame(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const requester = room.players.find((p) => p.userId === socket.data.userId);

    if (!requester?.isAdmin) {
      socket.emit(WS_EVENTS_OUT.ERROR, {
        message: 'Only the room admin can start the game',
      });
      return;
    }
    if (room.status !== RoomStatus.WAITING) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'Game already started' });
      return;
    }
    const activePlayers = room.players.filter(
      (p) =>
        p.status === RoomPlayerStatus.JOINED ||
        p.status === RoomPlayerStatus.READY,
    );
    if (activePlayers.length < room.gameType.minPlayers) {
      socket.emit(WS_EVENTS_OUT.ERROR, {
        message: `Need at least ${room.gameType.minPlayers} players to start`,
      });
      return;
    }

    const gameState = await this.gameStateService.startGame(room);
    this.server.to(payload.roomId).emit(WS_EVENTS_OUT.GAME_STARTED, {
      boardState: gameState.boardState,
      currentTurnSeat: gameState.currentTurnSeat,
    });

    this.scheduleTurnTimeoutFor(room.id);
  }

  @SubscribeMessage(WS_EVENTS_IN.ROLL_DICE)
  async onRollDice(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    this.scheduler.clearTurnTimeout(room.id);

    const engine = this.gameEngineFactory.getEngine(room.gameType.code);
    const seats = this.gameStateService.toSeats(room.players);
    const rollResult = engine.rollDice(
      gameState.boardState,
      seats,
      player.seatIndex,
      room.rulesJson,
    );

    this.server.to(room.id).emit(WS_EVENTS_OUT.DICE_ROLLED, {
      seatIndex: player.seatIndex,
      diceValue: rollResult.diceValue,
    });

    if (rollResult.autoResolved && rollResult.moveResult) {
      await this.applyAndBroadcastMove(
        room,
        gameState,
        player.seatIndex,
        rollResult.diceValue,
        rollResult.moveResult,
      );
    } else {
      // Player must choose which token to move (Ludo, multiple options).
      await this.gameStateService.updateGameState(gameState, {
        lastRoll: rollResult.diceValue,
      });
      this.server.to(room.id).emit(WS_EVENTS_OUT.AWAITING_MOVE_CHOICE, {
        seatIndex: player.seatIndex,
        diceValue: rollResult.diceValue,
      });
      this.scheduleTurnTimeoutFor(room.id);
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.MAKE_MOVE)
  async onMakeMove(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: MakeMovePayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }
    if (gameState.lastRoll == null) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'Roll the dice first' });
      return;
    }

    this.scheduler.clearTurnTimeout(room.id);

    const engine = this.gameEngineFactory.getEngine(room.gameType.code);
    const seats = this.gameStateService.toSeats(room.players);

    try {
      const moveResult = engine.applyMove(
        gameState.boardState,
        seats,
        player.seatIndex,
        gameState.lastRoll,
        { tokenId: payload.tokenId },
        room.rulesJson,
      );
      await this.applyAndBroadcastMove(
        room,
        gameState,
        player.seatIndex,
        gameState.lastRoll,
        moveResult,
      );
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
      this.scheduleTurnTimeoutFor(room.id);
    }
  }

  private async applyAndBroadcastMove(
    room: Room,
    gameState: Awaited<ReturnType<GameStateService['getGameState']>>,
    seatIndex: number,
    diceValue: number,
    moveResult: {
      boardState: Record<string, unknown>;
      nextTurnSeat: number;
      isGameOver: boolean;
      winnerSeat?: number;
      movePayload: Record<string, unknown>;
    },
  ) {
    await this.gameStateService.recordMove(
      room.id,
      seatIndex,
      diceValue,
      moveResult.movePayload,
    );

    await this.gameStateService.updateGameState(gameState, {
      boardState: moveResult.boardState,
      currentTurnSeat: moveResult.nextTurnSeat,
      lastRoll: null,
    });

    this.server.to(room.id).emit(WS_EVENTS_OUT.MOVE_APPLIED, {
      seatIndex,
      boardState: moveResult.boardState,
      nextTurnSeat: moveResult.nextTurnSeat,
      movePayload: moveResult.movePayload,
    });

    if (moveResult.isGameOver) {
      this.scheduler.clearAllForRoom(room.id);
      await this.gameStateService.finishGame(room.id);
      this.server.to(room.id).emit(WS_EVENTS_OUT.GAME_OVER, {
        winnerSeat: moveResult.winnerSeat,
      });
    } else {
      this.scheduleTurnTimeoutFor(room.id);
    }
  }

  /** Skips the current player's turn (used on turn timeout). */
  private async skipCurrentTurn(roomId: string, reason: string) {
    try {
      const room = await this.roomsService.findRoomOrThrow(roomId);
      if (room.status !== RoomStatus.IN_PROGRESS) return;

      const gameState = await this.gameStateService.getGameState(roomId);
      const seats = this.gameStateService.toSeats(room.players);

      const sortedActive = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
      const currentIdx = sortedActive.findIndex(
        (s) => s.seatIndex === gameState.currentTurnSeat,
      );
      const nextSeat =
        sortedActive[(currentIdx + 1) % sortedActive.length]?.seatIndex ??
        gameState.currentTurnSeat;

      const skippedSeat = gameState.currentTurnSeat;

      await this.gameStateService.updateGameState(gameState, {
        currentTurnSeat: nextSeat,
        lastRoll: null,
      });

      this.server.to(roomId).emit(WS_EVENTS_OUT.TURN_SKIPPED, {
        seatIndex: skippedSeat,
        reason,
      });

      this.scheduleTurnTimeoutFor(roomId);
    } catch (err) {
      this.logger.warn(
        `Failed to skip turn for room ${roomId}: ${(err as Error).message}`,
      );
    }
  }

  private scheduleTurnTimeoutFor(roomId: string) {
    this.scheduler.scheduleTurnTimeout(roomId, () => {
      void this.skipCurrentTurn(roomId, 'timeout');
    });
  }

  private broadcastRoomState(room: Room) {
    this.server
      .to(room.id)
      .emit(WS_EVENTS_OUT.ROOM_STATE, serializeRoomForResponse(room));
  }
}
