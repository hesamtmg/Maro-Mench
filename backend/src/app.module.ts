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
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      load: [typeormConfig],
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
  ],
})
export class AppModule {}
