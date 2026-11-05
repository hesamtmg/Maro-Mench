import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import typeormConfig from './config/typeorm.config';
import { AuthModule } from './modules/auth/auth.module';
import { GameEngineModule } from './modules/game-engine/game-engine.module';
import { GameGatewayModule } from './modules/game-gateway/game-gateway.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { StatsModule } from './modules/stats/stats.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      load: [typeormConfig],
      // Fail at startup with a readable message instead of passport-jwt's
      // "JwtStrategy requires a secret or key" deep in the DI stack.
      validate: (config: Record<string, unknown>) => {
        const missing = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'].filter(
          (key) => !config[key],
        );
        if (missing.length) {
          throw new Error(
            `Missing required environment variable(s): ${missing.join(', ')}. ` +
              'Copy backend/.env.example to backend/.env (local) or to .env in ' +
              'the repo root (docker compose) and set them.',
          );
        }
        return config;
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.get('database') as TypeOrmModuleOptions,
    }),
    UsersModule,
    AuthModule,
    RoomsModule,
    GameEngineModule,
    GameGatewayModule,
    MatchmakingModule,
    StatsModule,
  ],
})
export class AppModule {}
