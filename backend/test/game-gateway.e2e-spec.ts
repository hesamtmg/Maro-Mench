import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import {
  WS_EVENTS_IN,
  WS_EVENTS_OUT,
} from '../src/modules/game-gateway/ws-events.constants';

const TEST_PORT = 3099;

describe('Game Gateway (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.listen(TEST_PORT);

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    sockets.length = 0;
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE users, refresh_tokens, password_reset_tokens, rooms, room_players, matchmaking_tickets, game_states, game_moves CASCADE`,
    );
  });

  async function registerUser(suffix: string) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        phoneNumber: `+1555100${suffix}`,
        email: `gw-e2e-${suffix}@example.com`,
        password: 'password123',
        displayName: `Player ${suffix}`,
      })
      .expect(201);
    return {
      accessToken: response.body.tokens.accessToken as string,
      userId: response.body.user.id as string,
    };
  }

  function connectSocket(accessToken: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`http://localhost:${TEST_PORT}/game`, {
        auth: { token: accessToken },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('connect timeout')), 5000);
    });
  }

  function waitForEvent<T = any>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${event}"`)),
        5000,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  async function createRoom(
    accessToken: string,
    body: Record<string, unknown>,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/rooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)
      .expect(201);
    return response.body;
  }

  async function joinRoom(accessToken: string, roomId: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    return response.body;
  }

  it('disconnects a socket that connects with no auth token', async () => {
    const socket = io(`http://localhost:${TEST_PORT}/game`, {
      auth: { token: undefined },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);

    // The gateway's handleConnection authenticates after the transport
    // connects, then force-disconnects unauthenticated sockets — so we
    // wait for the disconnect rather than expecting connect to fail.
    const disconnected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('expected disconnect did not happen')),
        5000,
      );
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await expect(disconnected).resolves.toBeUndefined();
  });

  it('lets a room member join and receive room_state over the socket', async () => {
    const host = await registerUser('1');
    const room = await createRoom(host.accessToken, {
      gameTypeCode: 'ludo',
      visibility: 'public',
      maxPlayers: 4,
    });

    const hostSocket = await connectSocket(host.accessToken);
    hostSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });

    const roomState = await waitForEvent(hostSocket, WS_EVENTS_OUT.ROOM_STATE);
    expect(roomState.id).toBe(room.id);
    expect(roomState.players).toHaveLength(1);
  });

  it('rejects join_room for a user who is not a member of the room', async () => {
    const host = await registerUser('2');
    const outsider = await registerUser('3');
    const room = await createRoom(host.accessToken, {
      gameTypeCode: 'ludo',
      visibility: 'private',
      maxPlayers: 4,
    });

    const outsiderSocket = await connectSocket(outsider.accessToken);
    outsiderSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });

    const errorPayload = await waitForEvent(
      outsiderSocket,
      WS_EVENTS_OUT.ERROR,
    );
    expect(errorPayload.message).toMatch(/not a member/i);
  });

  it('only allows the admin to start the game', async () => {
    const host = await registerUser('4');
    const guest = await registerUser('5');
    const room = await createRoom(host.accessToken, {
      gameTypeCode: 'ludo',
      visibility: 'public',
      maxPlayers: 2,
    });
    await joinRoom(guest.accessToken, room.id);

    const guestSocket = await connectSocket(guest.accessToken);
    guestSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(guestSocket, WS_EVENTS_OUT.ROOM_STATE);

    guestSocket.emit(WS_EVENTS_IN.START_GAME, { roomId: room.id });
    const errorPayload = await waitForEvent(guestSocket, WS_EVENTS_OUT.ERROR);
    expect(errorPayload.message).toMatch(/admin/i);
  });

  it('starts a Ludo game and broadcasts game_started to all members', async () => {
    const host = await registerUser('6');
    const guest = await registerUser('7');
    const room = await createRoom(host.accessToken, {
      gameTypeCode: 'ludo',
      visibility: 'public',
      maxPlayers: 2,
    });
    await joinRoom(guest.accessToken, room.id);

    const hostSocket = await connectSocket(host.accessToken);
    const guestSocket = await connectSocket(guest.accessToken);

    hostSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(hostSocket, WS_EVENTS_OUT.ROOM_STATE);
    guestSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(guestSocket, WS_EVENTS_OUT.ROOM_STATE);

    const guestGameStarted = waitForEvent(
      guestSocket,
      WS_EVENTS_OUT.GAME_STARTED,
    );
    hostSocket.emit(WS_EVENTS_IN.START_GAME, { roomId: room.id });

    const payload = await guestGameStarted;
    expect(payload.currentTurnSeat).toBe(0);
    expect(payload.boardState.tokens[0]).toHaveLength(4);
    expect(payload.boardState.tokens[1]).toHaveLength(4);
  });

  it('rejects rolling out of turn', async () => {
    const host = await registerUser('8');
    const guest = await registerUser('9');
    const room = await createRoom(host.accessToken, {
      gameTypeCode: 'ludo',
      visibility: 'public',
      maxPlayers: 2,
    });
    await joinRoom(guest.accessToken, room.id);

    const hostSocket = await connectSocket(host.accessToken);
    const guestSocket = await connectSocket(guest.accessToken);
    hostSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(hostSocket, WS_EVENTS_OUT.ROOM_STATE);
    guestSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(guestSocket, WS_EVENTS_OUT.ROOM_STATE);

    hostSocket.emit(WS_EVENTS_IN.START_GAME, { roomId: room.id });
    await waitForEvent(guestSocket, WS_EVENTS_OUT.GAME_STARTED);

    // Seat 0 (host) goes first; guest trying to roll should be rejected.
    guestSocket.emit(WS_EVENTS_IN.ROLL_DICE, { roomId: room.id });
    const errorPayload = await waitForEvent(guestSocket, WS_EVENTS_OUT.ERROR);
    expect(errorPayload.message).toMatch(/not your turn/i);
  });

  it('plays a full Snakes & Ladders turn and advances turn order', async () => {
    const host = await registerUser('10');
    const guest = await registerUser('11');
    const room = await createRoom(host.accessToken, {
      gameTypeCode: 'snakes_ladders',
      visibility: 'public',
      maxPlayers: 2,
    });
    await joinRoom(guest.accessToken, room.id);

    const hostSocket = await connectSocket(host.accessToken);
    const guestSocket = await connectSocket(guest.accessToken);
    hostSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(hostSocket, WS_EVENTS_OUT.ROOM_STATE);
    guestSocket.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId: room.id });
    await waitForEvent(guestSocket, WS_EVENTS_OUT.ROOM_STATE);

    hostSocket.emit(WS_EVENTS_IN.START_GAME, { roomId: room.id });
    await waitForEvent(guestSocket, WS_EVENTS_OUT.GAME_STARTED);

    const moveApplied = waitForEvent(guestSocket, WS_EVENTS_OUT.MOVE_APPLIED);
    hostSocket.emit(WS_EVENTS_IN.ROLL_DICE, { roomId: room.id });

    const payload = await moveApplied;
    // Snakes & Ladders auto-resolves; turn should move to seat 1 (guest)
    // unless the roll happened to land exactly on square 100 (extremely
    // unlikely from square 0 with a single d6 roll, so not handled here).
    expect(payload.nextTurnSeat).toBe(1);
    expect(payload.seatIndex).toBe(0);
  });

  it('rejects kick attempts in a matchmaking-formed room', async () => {
    const p1 = await registerUser('12');
    const p2 = await registerUser('13');

    const socket1 = await connectSocket(p1.accessToken);
    const socket2 = await connectSocket(p2.accessToken);

    const match1 = waitForEvent(socket1, WS_EVENTS_OUT.MATCH_FOUND);
    const match2 = waitForEvent(socket2, WS_EVENTS_OUT.MATCH_FOUND);

    socket1.emit(WS_EVENTS_IN.JOIN_QUEUE, { gameTypeCode: 'ludo' });
    socket2.emit(WS_EVENTS_IN.JOIN_QUEUE, { gameTypeCode: 'ludo' });

    // Ludo's maxPlayers is 4, but our fill-wait timer (200ms in test env)
    // will settle for the 2 queued players once it expires.
    const [payload1] = await Promise.all([match1, match2]);
    const roomId = payload1.roomId;

    socket1.emit(WS_EVENTS_IN.JOIN_ROOM, { roomId });
    await waitForEvent(socket1, WS_EVENTS_OUT.ROOM_STATE);

    socket1.emit(WS_EVENTS_IN.KICK_PLAYER, {
      roomId,
      targetUserId: p2.userId,
    });
    const errorPayload = await waitForEvent(socket1, WS_EVENTS_OUT.ERROR);
    expect(errorPayload.message).toMatch(/matchmaking/i);
  });
});
