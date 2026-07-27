import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { GameTypeCode } from '../../rooms/entities/game-type.entity';

export class LeaderboardQueryDto {
  @IsEnum(GameTypeCode)
  gameTypeCode: GameTypeCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
