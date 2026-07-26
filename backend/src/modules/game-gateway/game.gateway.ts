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
import { ConquestEngine } from '../game-engine/conquest/conquest.engine';
import { TERRITORY_BY_ID } from '../game-engine/conquest/board-config';
import { GameEngineFactory } from '../game-engine/game-engine.factory';
import { BOARD, HOTEL_LEVEL } from '../game-engine/monopoly/board-config';
import { MonopolyEngine } from '../game-engine/monopoly/monopoly.engine';
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

interface OloLivePositionsPayload {
  roomId: string;
  positions: Array<{ id: string; x: number; y: number }>;
}

interface OloShotResultPayload {
  roomId: string;
  boardState: Record<string, unknown>;
  nextTurnSeat: number;
  isGameOver: boolean;
  winnerSeat?: number;
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
    private readonly monopolyEngine: MonopolyEngine,
    private readonly conquestEngine: ConquestEngine,
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
    // Broadcast to the whole room, not just the joiner -- other members
    // already sitting in the waiting room need this to see the new
    // player appear (and for the admin's start-game gating to react).
    this.broadcastRoomState(refreshedRoom);
    if (refreshedRoom.visibility === RoomVisibility.PUBLIC) {
      this.server.emit(WS_EVENTS_OUT.ROOM_LIST_UPDATED, {
        roomId: refreshedRoom.id,
      });
    }

    if (refreshedRoom.status === RoomStatus.IN_PROGRESS) {
      const gameState = await this.gameStateService.getGameState(
        payload.roomId,
      );
      socket.emit(WS_EVENTS_OUT.GAME_STARTED, {
        boardState: gameState.boardState,
        currentTurnSeat: gameState.currentTurnSeat,
        isPaused: this.scheduler.isPaused(payload.roomId),
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

    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);

    if (player && room.status === RoomStatus.IN_PROGRESS) {
      // Hitting "leave" mid-game is treated the same as a disconnect --
      // it keeps your seat (and boardState) intact so you can rejoin and
      // resume later, rather than permanently vacating it. The active
      // turn-timeout (if it's your turn) will auto-skip you when it
      // fires, same as a dropped connection would.
      await this.roomsService.markPlayerStatus(
        player.id,
        RoomPlayerStatus.DISCONNECTED,
      );
      this.server.to(payload.roomId).emit(WS_EVENTS_OUT.PLAYER_DISCONNECTED, {
        userId: socket.data.userId,
        seatIndex: player.seatIndex,
      });
      return;
    }

    // Waiting room (or already finished): leaving actually frees the seat.
    const updatedRoom = await this.roomsService.leaveRoom(
      payload.roomId,
      socket.data.userId,
    );
    this.broadcastRoomState(updatedRoom);
    this.server.to(payload.roomId).emit(WS_EVENTS_OUT.PLAYER_LEFT, {
      userId: socket.data.userId,
    });
    if (updatedRoom.visibility === RoomVisibility.PUBLIC) {
      this.server.emit(WS_EVENTS_OUT.ROOM_LIST_UPDATED, {
        roomId: updatedRoom.id,
      });
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

  @SubscribeMessage(WS_EVENTS_IN.DELETE_ROOM)
  async onDeleteRoom(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    try {
      const room = await this.roomsService.deleteRoom(
        payload.roomId,
        socket.data.userId,
      );
      this.scheduler.clearAllForRoom(payload.roomId);
      this.server
        .to(payload.roomId)
        .emit(WS_EVENTS_OUT.ROOM_DELETED, { roomId: payload.roomId });
      if (room.visibility === RoomVisibility.PUBLIC) {
        this.server.emit(WS_EVENTS_OUT.ROOM_LIST_UPDATED, {
          roomId: payload.roomId,
        });
      }
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
    // startGame() flips room.status to IN_PROGRESS on this same in-memory
    // instance; broadcast it so clients already sitting in the room (whose
    // local room.status otherwise never changes) leave the waiting view.
    this.broadcastRoomState(room);
    this.server.to(payload.roomId).emit(WS_EVENTS_OUT.GAME_STARTED, {
      boardState: gameState.boardState,
      currentTurnSeat: gameState.currentTurnSeat,
    });

    this.scheduleTurnTimeoutFor(room);
  }

  /** Any seated player may pause an in-progress game -- freezes the turn
   * timer (remembering how much time was left) and blocks every
   * turn-consuming action until someone resumes it. */
  @SubscribeMessage(WS_EVENTS_IN.PAUSE_GAME)
  async onPauseGame(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'You are not in this room' });
      return;
    }
    if (room.status !== RoomStatus.IN_PROGRESS) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'The game is not in progress' });
      return;
    }
    if (this.scheduler.isPaused(room.id)) return;

    this.scheduler.pauseRoom(room.id);
    this.server.to(room.id).emit(WS_EVENTS_OUT.GAME_PAUSED, {
      seatIndex: player.seatIndex,
    });
  }

  @SubscribeMessage(WS_EVENTS_IN.RESUME_GAME)
  async onResumeGame(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'You are not in this room' });
      return;
    }
    if (!this.scheduler.isPaused(room.id)) return;

    const remainingMs = this.scheduler.resumeRoom(room.id, () => {
      void this.skipCurrentTurn(room.id, 'timeout');
    });
    this.server.to(room.id).emit(WS_EVENTS_OUT.GAME_RESUMED, {
      seatIndex: player.seatIndex,
      turnDeadline: Date.now() + remainingMs,
    });
  }

  /** Guard for every turn-consuming action -- rejects it while the room is paused. */
  private rejectIfPaused(
    socket: AuthenticatedSocket,
    roomId: string,
  ): boolean {
    if (this.scheduler.isPaused(roomId)) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'The game is paused' });
      return true;
    }
    return false;
  }

  @SubscribeMessage(WS_EVENTS_IN.ROLL_DICE)
  async onRollDice(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: RoomIdPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    if (room.gameType.code === GameTypeCode.MONOPOLY && this.hasMonopolyPendingDecision(gameState.boardState)) {
      // A purchase decision, auction, or debt is frozen on this exact
      // seat -- re-rolling here would silently move past it (or double
      // up a second landing effect) instead of resolving it first.
      socket.emit(WS_EVENTS_OUT.ERROR, {
        message: 'Resolve the pending decision before rolling again',
      });
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
      this.scheduleTurnTimeoutFor(room);
    }
  }

  @SubscribeMessage(WS_EVENTS_IN.MAKE_MOVE)
  async onMakeMove(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: MakeMovePayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
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
      this.scheduleTurnTimeoutFor(room);
    }
  }

  /**
   * OLO is real-time physics (drag-and-flick), not discrete dice/moves --
   * it bypasses ROLL_DICE/MAKE_MOVE/engine.applyMove entirely. The
   * shooting client runs Matter.js locally and is trusted to report the
   * settled result directly (the "relay" model): this just relays live
   * positions while a shot is mid-flight (not persisted -- purely a
   * visual sync for the other player) ...
   */
  @SubscribeMessage(WS_EVENTS_IN.OLO_LIVE_POSITIONS)
  onOloLivePositions(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: OloLivePositionsPayload,
  ) {
    socket.to(payload.roomId).emit(WS_EVENTS_OUT.OLO_LIVE_POSITIONS, payload);
  }

  /** ... and persists + broadcasts the final result once a shot settles,
   * same as applyAndBroadcastMove does for the discrete-move games. */
  @SubscribeMessage(WS_EVENTS_IN.OLO_SHOT_RESULT)
  async onOloShotResult(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: OloShotResultPayload,
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    this.scheduler.clearTurnTimeout(room.id);

    await this.gameStateService.recordMove(room.id, player.seatIndex, null, {
      nextTurnSeat: payload.nextTurnSeat,
    });

    await this.gameStateService.updateGameState(gameState, {
      boardState: payload.boardState,
      currentTurnSeat: payload.nextTurnSeat,
    });

    this.server.to(room.id).emit(WS_EVENTS_OUT.OLO_SHOT_RESULT, {
      seatIndex: player.seatIndex,
      boardState: payload.boardState,
      nextTurnSeat: payload.nextTurnSeat,
    });

    if (payload.isGameOver) {
      this.scheduler.clearAllForRoom(room.id);
      await this.gameStateService.finishGame(room.id);
      this.server.to(room.id).emit(WS_EVENTS_OUT.GAME_OVER, {
        winnerSeat: payload.winnerSeat,
      });
    } else {
      this.scheduleTurnTimeoutFor(room);
    }
  }

  /** Monopoly-only: answers a pending "buy this property?" offer after landing. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_PURCHASE_DECISION)
  async onMonopolyPurchaseDecision(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; buy: boolean },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    this.scheduler.clearTurnTimeout(room.id);
    const seats = this.gameStateService.toSeats(room.players);

    try {
      const moveResult = this.monopolyEngine.resolvePurchaseDecision(
        gameState.boardState,
        seats,
        player.seatIndex,
        payload.buy,
      );
      await this.applyAndBroadcastMove(
        room,
        gameState,
        player.seatIndex,
        0,
        moveResult,
      );
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
      this.scheduleTurnTimeoutFor(room);
    }
  }

  /** Monopoly-only: builds one house/hotel level. Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_BUILD_HOUSE)
  async onMonopolyBuildHouse(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; spaceIndex: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.monopolyEngine.buildHouse(
        gameState.boardState,
        player.seatIndex,
        payload.spaceIndex,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      const houses = (
        boardState as unknown as {
          properties: Record<number, { houses: number }>;
        }
      ).properties[payload.spaceIndex].houses;
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        builtHouse: BOARD[payload.spaceIndex].name,
        isHotel: houses >= HOTEL_LEVEL,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: sells one house/hotel level back to the bank. Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_SELL_HOUSE)
  async onMonopolySellHouse(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; spaceIndex: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.monopolyEngine.sellHouse(
        gameState.boardState,
        player.seatIndex,
        payload.spaceIndex,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        soldHouse: BOARD[payload.spaceIndex].name,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: mortgages an owned property for half its price. Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_MORTGAGE)
  async onMonopolyMortgage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; spaceIndex: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.monopolyEngine.mortgageProperty(
        gameState.boardState,
        player.seatIndex,
        payload.spaceIndex,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        mortgaged: BOARD[payload.spaceIndex].name,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: pays off a mortgaged property (value + 10% interest). Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_UNMORTGAGE)
  async onMonopolyUnmortgage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; spaceIndex: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.monopolyEngine.unmortgageProperty(
        gameState.boardState,
        player.seatIndex,
        payload.spaceIndex,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        unmortgaged: BOARD[payload.spaceIndex].name,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: pays off a pending debt once enough cash has been raised. Resumes the main turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_PAY_DEBT)
  async onMonopolyPayDebt(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }
    const seats = this.gameStateService.toSeats(room.players);

    try {
      const moveResult = this.monopolyEngine.payDebt(
        gameState.boardState,
        seats,
        player.seatIndex,
      );
      this.scheduler.clearTurnTimeout(room.id);
      await this.applyAndBroadcastMove(room, gameState, player.seatIndex, 0, moveResult);
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: gives up on a pending debt, liquidating to the bank. Resumes the main turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_DECLARE_BANKRUPTCY)
  async onMonopolyDeclareBankruptcy(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }
    const seats = this.gameStateService.toSeats(room.players);

    try {
      const moveResult = this.monopolyEngine.declareBankruptcy(
        gameState.boardState,
        seats,
        player.seatIndex,
      );
      this.scheduler.clearTurnTimeout(room.id);
      await this.applyAndBroadcastMove(room, gameState, player.seatIndex, 0, moveResult);
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: pays the jail fine (or spends a get-out-of-jail card). Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_PAY_JAIL_FINE)
  async onMonopolyPayJailFine(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.monopolyEngine.payJailFine(
        gameState.boardState,
        player.seatIndex,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        paidJailFine: true,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /**
   * Monopoly-only: bids in an active auction. Not gated to currentTurnSeat
   * -- any active player can be the current bidder regardless of whose
   * main turn it nominally is (the engine enforces auction turn order).
   */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_PLACE_BID)
  async onMonopolyPlaceBid(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; amount: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'You are not in this room' });
      return;
    }
    const gameState = await this.gameStateService.getGameState(room.id);

    try {
      const boardState = this.monopolyEngine.placeBid(
        gameState.boardState,
        player.seatIndex,
        payload.amount,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      const auctionSpaceIndex = (
        boardState as unknown as { auction: { spaceIndex: number } }
      ).auction.spaceIndex;
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        bidPlaced: payload.amount,
        bidSpace: BOARD[auctionSpaceIndex].name,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: passes in an active auction. May resolve the auction and resume the main turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_PASS_AUCTION)
  async onMonopolyPassAuction(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'You are not in this room' });
      return;
    }
    const gameState = await this.gameStateService.getGameState(room.id);
    const seats = this.gameStateService.toSeats(room.players);

    try {
      const result = this.monopolyEngine.passAuction(
        gameState.boardState,
        seats,
        player.seatIndex,
      );
      if (result.resolved && result.moveResult) {
        this.scheduler.clearTurnTimeout(room.id);
        await this.applyAndBroadcastMove(
          room,
          gameState,
          player.seatIndex,
          0,
          result.moveResult,
        );
      } else {
        await this.gameStateService.updateGameState(gameState, {
          boardState: result.boardState,
        });
        const auctionSpaceIndex = (
          result.boardState as unknown as { auction: { spaceIndex: number } }
        ).auction.spaceIndex;
        this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
          boardState: result.boardState,
          seatIndex: player.seatIndex,
          auctionPassed: BOARD[auctionSpaceIndex].name,
        });
      }
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: proposes a trade to another player. Can happen anytime, not just on your turn. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_PROPOSE_TRADE)
  async onMonopolyProposeTrade(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody()
    payload: {
      roomId: string;
      toSeat: number;
      offerCash: number;
      offerProperties: number[];
      offerJailCards: number;
      requestCash: number;
      requestProperties: number[];
      requestJailCards: number;
    },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'You are not in this room' });
      return;
    }
    const gameState = await this.gameStateService.getGameState(room.id);

    try {
      const boardState = this.monopolyEngine.proposeTrade(
        gameState.boardState,
        player.seatIndex,
        payload.toSeat,
        payload,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        tradeProposedTo: payload.toSeat,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Monopoly-only: accepts, declines, or cancels a pending trade. */
  @SubscribeMessage(WS_EVENTS_IN.MONOPOLY_RESPOND_TRADE)
  async onMonopolyRespondTrade(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; tradeId: string; accept: boolean },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    if (!player) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'You are not in this room' });
      return;
    }
    const gameState = await this.gameStateService.getGameState(room.id);

    try {
      const trades = (
        gameState.boardState as unknown as {
          trades: Array<{ id: string; fromSeat: number; toSeat: number }>;
        }
      ).trades;
      const trade = trades.find((t) => t.id === payload.tradeId);
      const otherSeat =
        trade == null
          ? null
          : trade.fromSeat === player.seatIndex
            ? trade.toSeat
            : trade.fromSeat;

      const boardState = this.monopolyEngine.respondToTrade(
        gameState.boardState,
        player.seatIndex,
        payload.tradeId,
        payload.accept,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        tradeResponded: payload.accept,
        tradeWithSeat: otherSeat,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Conquest-only: places reinforcement armies on an owned territory. Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_REINFORCE)
  async onConquestReinforce(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; territoryId: string; count: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.conquestEngine.reinforce(
        gameState.boardState,
        player.seatIndex,
        payload.territoryId,
        payload.count,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.CONQUEST_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        reinforced: TERRITORY_BY_ID[payload.territoryId]?.name ?? payload.territoryId,
        count: payload.count,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Conquest-only: resolves one attack roll. Doesn't consume the turn -- an attacker can keep attacking. */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_ATTACK)
  async onConquestAttack(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody()
    payload: { roomId: string; fromId: string; toId: string; diceCount: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const { boardState, combat } = this.conquestEngine.attack(
        gameState.boardState,
        player.seatIndex,
        payload.fromId,
        payload.toId,
        payload.diceCount,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.CONQUEST_ATTACK_RESULT, {
        boardState,
        seatIndex: player.seatIndex,
        combat,
      });

      if (combat.isGameOver) {
        this.scheduler.clearAllForRoom(room.id);
        await this.gameStateService.finishGame(room.id);
        this.server.to(room.id).emit(WS_EVENTS_OUT.GAME_OVER, {
          winnerSeat: combat.winnerSeat,
        });
      }
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Conquest-only: voluntarily ends the attack phase (no more attacks this turn) and moves to fortify. */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_END_ATTACK_PHASE)
  async onConquestEndAttackPhase(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const boardState = this.conquestEngine.endAttackPhase(
        gameState.boardState,
        player.seatIndex,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.CONQUEST_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        movedToFortify: true,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Conquest-only: trades in a matched set of 3 cards for reinforcements during the reinforce phase. Doesn't consume the turn. */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_TRADE_CARDS)
  async onConquestTradeCards(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; cardIds: string[] },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const { boardState, bonus, territoryBonusId } = this.conquestEngine.tradeInCards(
        gameState.boardState,
        player.seatIndex,
        payload.cardIds,
      );
      await this.gameStateService.updateGameState(gameState, { boardState });
      this.server.to(room.id).emit(WS_EVENTS_OUT.CONQUEST_STATE_UPDATED, {
        boardState,
        seatIndex: player.seatIndex,
        tradedIn: true,
        bonus,
        territoryBonusId,
      });
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Conquest-only: moves armies once between owned, connected territories, ending the turn. */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_FORTIFY)
  async onConquestFortify(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody()
    payload: { roomId: string; fromId: string; toId: string; count: number },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const moveResult = this.conquestEngine.fortify(
        gameState.boardState,
        player.seatIndex,
        payload.fromId,
        payload.toId,
        payload.count,
      );
      await this.applyAndBroadcastMove(room, gameState, player.seatIndex, 0, moveResult);
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /** Conquest-only: ends the turn without fortifying (from the attack or fortify phase). */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_END_TURN)
  async onConquestEndTurn(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const moveResult = this.conquestEngine.endTurn(
        gameState.boardState,
        player.seatIndex,
      );
      await this.applyAndBroadcastMove(room, gameState, player.seatIndex, 0, moveResult);
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
    }
  }

  /**
   * Conquest-only: voluntarily passes the rest of the current player's
   * turn from any phase, including mid-reinforce -- reuses the same
   * auto-place-leftover-reinforcements-then-advance logic the turn
   * -timeout scheduler falls back to, just triggered on demand instead of
   * after the (now much longer) timer expires.
   */
  @SubscribeMessage(WS_EVENTS_IN.CONQUEST_PASS_TURN)
  async onConquestPassTurn(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    const room = await this.roomsService.findRoomOrThrow(payload.roomId);
    const player = room.players.find((p) => p.userId === socket.data.userId);
    if (this.rejectIfPaused(socket, room.id)) return;
    const gameState = await this.gameStateService.getGameState(room.id);

    if (!player || player.seatIndex !== gameState.currentTurnSeat) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: 'It is not your turn' });
      return;
    }

    try {
      const moveResult = this.conquestEngine.forceEndTurn(gameState.boardState);
      await this.applyAndBroadcastMove(room, gameState, player.seatIndex, 0, moveResult);
    } catch (err) {
      socket.emit(WS_EVENTS_OUT.ERROR, { message: (err as Error).message });
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
      this.scheduleTurnTimeoutFor(room);
    }
  }

  /** Skips the current player's turn (used on turn timeout). */
  private async skipCurrentTurn(roomId: string, reason: string) {
    try {
      const room = await this.roomsService.findRoomOrThrow(roomId);
      if (room.status !== RoomStatus.IN_PROGRESS) return;

      const gameState = await this.gameStateService.getGameState(roomId);
      const seats = this.gameStateService.toSeats(room.players);

      // Monopoly's pendingPurchase/auction pause the main turn on a
      // *different* seat than gameState.currentTurnSeat (the auction's
      // current bidder, say) -- blindly advancing currentTurnSeat here
      // would corrupt that in-progress decision. Auto-resolve it instead
      // (auto-pass the stalled bidder, or auto-decline a stalled
      // purchase) so the game can never get stuck.
      if (room.gameType.code === GameTypeCode.MONOPOLY) {
        const resolved = await this.autoResolveStalledMonopolyDecision(
          room,
          gameState,
          seats,
          reason,
        );
        if (resolved) return;
      }

      // Conquest has its own turn/phase state inside boardState (reinforce
      // -> attack -> fortify, with eliminated seats skipped) -- the generic
      // "cycle to the next seatIndex" fallback below doesn't know about any
      // of that, so a stalled Conquest turn is force-ended through the
      // engine instead, same idea as Monopoly's stalled-decision handling.
      if (room.gameType.code === GameTypeCode.CONQUEST) {
        const moveResult = this.conquestEngine.forceEndTurn(gameState.boardState);
        const skippedSeat = gameState.currentTurnSeat;
        this.server.to(roomId).emit(WS_EVENTS_OUT.TURN_SKIPPED, {
          seatIndex: skippedSeat,
          reason,
          nextTurnSeat: moveResult.nextTurnSeat,
        });
        await this.applyAndBroadcastMove(room, gameState, skippedSeat, 0, moveResult);
        return;
      }

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
        nextTurnSeat: nextSeat,
      });

      this.scheduleTurnTimeoutFor(room);
    } catch (err) {
      this.logger.warn(
        `Failed to skip turn for room ${roomId}: ${(err as Error).message}`,
      );
    }
  }

  /** Returns true if a stalled Monopoly decision was found and auto-resolved. */
  private async autoResolveStalledMonopolyDecision(
    room: Room,
    gameState: Awaited<ReturnType<GameStateService['getGameState']>>,
    seats: ReturnType<GameStateService['toSeats']>,
    reason: string,
  ): Promise<boolean> {
    const state = gameState.boardState as {
      auction?: { currentBidderSeat: number } | null;
      pendingPurchase?: unknown;
      pendingDebt?: unknown;
    };

    if (state.pendingDebt) {
      // Left hanging on a debt they could raise cash for -- default to
      // bankruptcy rather than let the game stall forever.
      const debtorSeat = gameState.currentTurnSeat;
      const moveResult = this.monopolyEngine.declareBankruptcy(
        gameState.boardState,
        seats,
        debtorSeat,
      );
      this.server.to(room.id).emit(WS_EVENTS_OUT.TURN_SKIPPED, {
        seatIndex: debtorSeat,
        reason,
        nextTurnSeat: gameState.currentTurnSeat,
      });
      await this.applyAndBroadcastMove(room, gameState, debtorSeat, 0, moveResult);
      return true;
    }

    if (state.auction) {
      const bidderSeat = state.auction.currentBidderSeat;
      const result = this.monopolyEngine.passAuction(
        gameState.boardState,
        seats,
        bidderSeat,
      );
      this.server.to(room.id).emit(WS_EVENTS_OUT.TURN_SKIPPED, {
        seatIndex: bidderSeat,
        reason,
        // Auction bidding doesn't move gameState.currentTurnSeat itself
        // (see resolvePurchaseDecision/passAuction); if this pass just
        // resolved the auction, the MOVE_APPLIED broadcast right after
        // this carries the real post-auction nextTurnSeat.
        nextTurnSeat: gameState.currentTurnSeat,
      });
      if (result.resolved && result.moveResult) {
        await this.applyAndBroadcastMove(room, gameState, bidderSeat, 0, result.moveResult);
      } else {
        await this.gameStateService.updateGameState(gameState, {
          boardState: result.boardState,
        });
        this.server
          .to(room.id)
          .emit(WS_EVENTS_OUT.MONOPOLY_STATE_UPDATED, { boardState: result.boardState });
        this.scheduleTurnTimeoutFor(room);
      }
      return true;
    }

    if (state.pendingPurchase) {
      const buyerSeat = gameState.currentTurnSeat;
      const moveResult = this.monopolyEngine.resolvePurchaseDecision(
        gameState.boardState,
        seats,
        buyerSeat,
        false,
      );
      this.server.to(room.id).emit(WS_EVENTS_OUT.TURN_SKIPPED, {
        seatIndex: buyerSeat,
        reason,
        // Auto-declining starts an auction rather than moving the turn --
        // the MOVE_APPLIED broadcast right after this carries the real
        // (unchanged, still buyerSeat) nextTurnSeat.
        nextTurnSeat: gameState.currentTurnSeat,
      });
      await this.applyAndBroadcastMove(room, gameState, buyerSeat, 0, moveResult);
      return true;
    }

    return false;
  }

  private hasMonopolyPendingDecision(boardState: Record<string, unknown>): boolean {
    const state = boardState as {
      pendingPurchase?: unknown;
      auction?: unknown;
      pendingDebt?: unknown;
    };
    return !!(state.pendingPurchase || state.auction || state.pendingDebt);
  }

  // Conquest turns get a much longer clock than the other games -- a
  // single turn there can span placing several reinforcements plus
  // multiple attack rolls, so the shared 30s default is too tight. Other
  // games keep the shared default by passing undefined through.
  private static readonly CONQUEST_TURN_TIMEOUT_MS = 10 * 60_000;

  private scheduleTurnTimeoutFor(room: Room) {
    const durationMs =
      room.gameType.code === GameTypeCode.CONQUEST
        ? GameGateway.CONQUEST_TURN_TIMEOUT_MS
        : undefined;
    this.scheduler.scheduleTurnTimeout(
      room.id,
      () => {
        void this.skipCurrentTurn(room.id, 'timeout');
      },
      durationMs,
    );
  }

  private broadcastRoomState(room: Room) {
    this.server
      .to(room.id)
      .emit(WS_EVENTS_OUT.ROOM_STATE, serializeRoomForResponse(room));
  }
}
