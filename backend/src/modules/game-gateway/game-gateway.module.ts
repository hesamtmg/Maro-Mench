import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { GameMove } from '../rooms/entities/game-move.entity';
import { GameState } from '../rooms/entities/game-state.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomPlayer } from '../rooms/entities/room-player.entity';
import { RoomsModule } from '../rooms/rooms.module';
import { GameStateService } from './game-state.service';
import { GameGateway } from './game.gateway';
import { RoomSchedulerService } from './room-scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomPlayer, GameState, GameMove]),
    RoomsModule,
    GameEngineModule,
    MatchmakingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  providers: [GameGateway, GameStateService, RoomSchedulerService],
})
export class GameGatewayModule {}
