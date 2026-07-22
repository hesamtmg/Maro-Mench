import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { GameTypeCode } from '../entities/game-type.entity';

export class RoomListQueryDto {
  @IsOptional()
  @IsEnum(GameTypeCode)
  gameTypeCode?: GameTypeCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}
