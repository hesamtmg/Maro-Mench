import { IsEnum, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import { GameTypeCode } from '../entities/game-type.entity';
import { RoomVisibility } from '../entities/room.entity';

export class CreateRoomDto {
  @IsEnum(GameTypeCode)
  gameTypeCode: GameTypeCode;

  @IsEnum(RoomVisibility)
  visibility: RoomVisibility.PRIVATE | RoomVisibility.PUBLIC;

  @IsInt()
  @Min(2)
  @Max(16)
  maxPlayers: number;

  @IsOptional()
  @IsObject()
  rulesJson?: Record<string, unknown>;
}
