import { IsString } from 'class-validator';

export class LoginDto {
  // Allow login with either email or phone number in the same field.
  @IsString()
  identifier: string;

  @IsString()
  password: string;
}
