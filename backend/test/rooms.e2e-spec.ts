import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Rooms (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

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
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
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
        phoneNumber: `+1555000${suffix}`,
        email: `room-e2e-${suffix}@example.com`,
        password: 'password123',
        displayName: `Player ${suffix}`,
      })
      .expect(201);
    return {
      accessToken: response.body.tokens.accessToken as string,
      userId: response.body.user.id as string,
    };
  }

  describe('POST /api/rooms', () => {
    it('creates a public Ludo room and auto-joins the creator as admin', async () => {
      const { accessToken, userId } = await registerUser('1');

      const response = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);

      expect(response.body.gameType.code).toBe('ludo');
      expect(response.body.visibility).toBe('public');
      expect(response.body.code).toBeNull();
      expect(response.body.players).toHaveLength(1);
      expect(response.body.players[0]).toMatchObject({
        userId,
        seatIndex: 0,
        isAdmin: true,
        color: 'red',
      });
    });

    it('creates a private room with a 6-character invite code', async () => {
      const { accessToken } = await registerUser('2');

      const response = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          gameTypeCode: 'snakes_ladders',
          visibility: 'private',
          maxPlayers: 6,
        })
        .expect(201);

      expect(response.body.code).toMatch(/^[A-Z2-9]{6}$/);
    });

    it('rejects maxPlayers outside the game type bounds', async () => {
      const { accessToken } = await registerUser('3');

      await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 5 })
        .expect(400);
    });

    it('rejects requests without an access token', async () => {
      await request(app.getHttpServer())
        .post('/api/rooms')
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(401);
    });

    it('never returns password hashes in the response', async () => {
      const { accessToken } = await registerUser('4');

      const response = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/passwordHash/i);
    });
  });

  describe('joining rooms', () => {
    it('joins a public room by id', async () => {
      const host = await registerUser('5');
      const guest = await registerUser('6');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);

      const roomId = createResponse.body.id;

      const joinResponse = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(201);

      expect(joinResponse.body.players).toHaveLength(2);
      const guestSeat = joinResponse.body.players.find(
        (p: any) => p.userId === guest.userId,
      );
      expect(guestSeat.seatIndex).toBe(1);
      expect(guestSeat.color).toBe('green');
    });

    it('joins a private room by code', async () => {
      const host = await registerUser('7');
      const guest = await registerUser('8');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'private', maxPlayers: 4 })
        .expect(201);

      const { code } = createResponse.body;

      const joinResponse = await request(app.getHttpServer())
        .post('/api/rooms/join-by-code')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ code })
        .expect(201);

      expect(joinResponse.body.players).toHaveLength(2);
    });

    it('rejects joining a private room via the public join-by-id endpoint', async () => {
      const host = await registerUser('9');
      const guest = await registerUser('10');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'private', maxPlayers: 4 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/rooms/${createResponse.body.id}/join`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(403);
    });

    it('rejects an invalid room code', async () => {
      const { accessToken } = await registerUser('11');

      await request(app.getHttpServer())
        .post('/api/rooms/join-by-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: 'ZZZZZZ' })
        .expect(404);
    });

    it('rejects joining a full room', async () => {
      const host = await registerUser('12');
      const guest1 = await registerUser('13');
      const guest2 = await registerUser('14');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 2 })
        .expect(201);
      const roomId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${guest1.accessToken}`)
        .expect(201); // fills the room (2/2)

      await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${guest2.accessToken}`)
        .expect(409); // room now full
    });
  });

  describe('GET /api/rooms (public room list)', () => {
    it('lists public rooms but not private ones', async () => {
      const host = await registerUser('16');

      await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'private', maxPlayers: 4 })
        .expect(201);

      const listResponse = await request(app.getHttpServer())
        .get('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .expect(200);

      expect(listResponse.body.rooms).toHaveLength(1);
      expect(listResponse.body.rooms[0].visibility).toBe('public');
    });

    it('filters by game type', async () => {
      const host = await registerUser('17');

      await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({
          gameTypeCode: 'snakes_ladders',
          visibility: 'public',
          maxPlayers: 4,
        })
        .expect(201);

      const listResponse = await request(app.getHttpServer())
        .get('/api/rooms')
        .query({ gameTypeCode: 'snakes_ladders' })
        .set('Authorization', `Bearer ${host.accessToken}`)
        .expect(200);

      expect(listResponse.body.rooms).toHaveLength(1);
      expect(listResponse.body.rooms[0].gameType.code).toBe('snakes_ladders');
    });
  });

  describe('kicking players', () => {
    it('allows the admin to kick a player', async () => {
      const host = await registerUser('18');
      const guest = await registerUser('19');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);
      const roomId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(201);

      const kickResponse = await request(app.getHttpServer())
        .delete(`/api/rooms/${roomId}/players/${guest.userId}`)
        .set('Authorization', `Bearer ${host.accessToken}`)
        .expect(200);

      expect(kickResponse.body.players).toHaveLength(1);
    });

    it('rejects kicking by a non-admin', async () => {
      const host = await registerUser('20');
      const guest = await registerUser('21');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);
      const roomId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/rooms/${roomId}/players/${host.userId}`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(403);
    });
  });

  describe('leaving rooms', () => {
    it('promotes the next player to admin when the admin leaves', async () => {
      const host = await registerUser('22');
      const guest = await registerUser('23');

      const createResponse = await request(app.getHttpServer())
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.accessToken}`)
        .send({ gameTypeCode: 'ludo', visibility: 'public', maxPlayers: 4 })
        .expect(201);
      const roomId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(201);

      const leaveResponse = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/leave`)
        .set('Authorization', `Bearer ${host.accessToken}`)
        .expect(201);

      const remainingPlayer = leaveResponse.body.players.find(
        (p: any) => p.userId === guest.userId,
      );
      expect(remainingPlayer.isAdmin).toBe(true);
    });
  });
});
