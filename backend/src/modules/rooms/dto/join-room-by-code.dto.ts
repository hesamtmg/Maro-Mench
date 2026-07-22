import { IsString, Length } from 'class-validator';

export class JoinRoomByCodeDto {
  @IsString()
  @Length(4, 12)
  code: string;
}
