import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { GameTypeCode } from '../../rooms/entities/game-type.entity';

export class JoinQueueDto {
  @IsEnum(GameTypeCode)
  gameTypeCode: GameTypeCode;

  @IsOptional()
  @IsObject()
  rulesJson?: Record<string, unknown>;
}
