import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
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
    // Keep tests isolated: wipe user-related tables between tests, but
    // leave game_types (seeded reference data) untouched.
    await dataSource.query(
      `TRUNCATE users, refresh_tokens, password_reset_tokens, rooms, room_players, matchmaking_tickets, game_states, game_moves CASCADE`,
    );
  });

  const validRegisterBody = {
    phoneNumber: '+15551230001',
    email: 'e2e-user@example.com',
    password: 'password123',
    displayName: 'E2E Tester',
  };

  describe('POST /api/auth/register', () => {
    it('registers a new user and returns tokens', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);

      expect(response.body.user).toMatchObject({
        email: validRegisterBody.email,
        phoneNumber: validRegisterBody.phoneNumber,
        displayName: validRegisterBody.displayName,
      });
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
      expect(response.body.tokens.refreshToken).toEqual(expect.any(String));
    });

    it('rejects a duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...validRegisterBody, phoneNumber: '+15551230002' })
        .expect(409);
    });

    it('rejects a duplicate phone number', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...validRegisterBody, email: 'different@example.com' })
        .expect(409);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...validRegisterBody, password: 'short' })
        .expect(400);
    });

    it('rejects an invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...validRegisterBody, email: 'not-an-email' })
        .expect(400);
    });

    it('rejects unexpected extra fields (whitelist validation)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...validRegisterBody, isAdmin: true })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);
    });

    it('logs in with email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          identifier: validRegisterBody.email,
          password: validRegisterBody.password,
        })
        .expect(200);

      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
    });

    it('logs in with phone number', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          identifier: validRegisterBody.phoneNumber,
          password: validRegisterBody.password,
        })
        .expect(200);

      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
    });

    it('rejects an incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          identifier: validRegisterBody.email,
          password: 'wrong-password',
        })
        .expect(401);
    });

    it('rejects a non-existent identifier', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'nobody@example.com', password: 'password123' })
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues a new token pair and rotates the refresh token', async () => {
      const registerResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);

      const oldRefreshToken = registerResponse.body.tokens.refreshToken;

      const refreshResponse = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken })
        .expect(200);

      expect(refreshResponse.body.accessToken).toEqual(expect.any(String));
      expect(refreshResponse.body.refreshToken).not.toBe(oldRefreshToken);

      // The old, now-rotated refresh token must no longer work.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken })
        .expect(401);
    });

    it('rejects a garbage refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the refresh token so it cannot be used again', async () => {
      const registerResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);

      const { accessToken, refreshToken } = registerResponse.body.tokens;

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('rejects logout without a valid access token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: 'whatever' })
        .expect(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns a generic success message for both existing and non-existing emails', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(validRegisterBody)
        .expect(201);

      const existingResponse = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: validRegisterBody.email })
        .expect(200);

      const nonExistentResponse = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'ghost@example.com' })
        .expect(200);

      // Same generic message either way, so we don't leak which emails
      // are registered.
      expect(existingResponse.body.message).toBe(
        nonExistentResponse.body.message,
      );
    });
  });
});
