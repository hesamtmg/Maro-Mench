import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomsModule } from '../rooms/rooms.module';
import { MatchmakingTicket } from './entities/matchmaking-ticket.entity';
import { MatchmakingService } from './matchmaking.service';

@Module({
  imports: [TypeOrmModule.forFeature([MatchmakingTicket]), RoomsModule],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
