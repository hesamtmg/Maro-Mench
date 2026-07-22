import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameMove } from './entities/game-move.entity';
import { GameState } from './entities/game-state.entity';
import { GameType } from './entities/game-type.entity';
import { RoomPlayer } from './entities/room-player.entity';
import { Room } from './entities/room.entity';
import { GameTypesService } from './game-types.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomPlayer, GameType, GameState, GameMove]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService, GameTypesService],
  exports: [RoomsService, GameTypesService],
})
export class RoomsModule {}
