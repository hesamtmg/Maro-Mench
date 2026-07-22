import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MoreThan, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SafeUser {
  id: string;
  email: string;
  phoneNumber: string;
  displayName: string;
  avatarUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
  ) {}

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }

  async register(
    dto: RegisterDto,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const [existingByEmail, existingByPhone] = await Promise.all([
      this.usersService.findByEmail(dto.email),
      this.usersService.findByPhoneNumber(dto.phoneNumber),
    ]);

    if (existingByEmail) {
      throw new ConflictException('Email is already registered');
    }
    if (existingByPhone) {
      throw new ConflictException('Phone number is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
    });

    const tokens = await this.issueTokens(user);
    return { user: this.toSafeUser(user), tokens };
  }

  async login(
    identifier: string,
    password: string,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const user = identifier.includes('@')
      ? await this.usersService.findByEmail(identifier)
      : await this.usersService.findByPhoneNumber(identifier);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user);
    return { user: this.toSafeUser(user), tokens };
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(rawRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.refreshTokenRepository.findOne({
      where: { userId: payload.sub, tokenHash },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Rotate: revoke the old refresh token and issue a fresh pair.
    stored.revokedAt = new Date();
    await this.refreshTokenRepository.save(stored);

    return this.issueTokens(user);
  }

  async logout(userId: string, rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.refreshTokenRepository.update(
      { userId, tokenHash },
      { revokedAt: new Date() },
    );
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // Always behave the same whether the user exists or not, to avoid
    // leaking which emails are registered.
    if (!user) {
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const resetToken = this.passwordResetTokenRepository.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    await this.passwordResetTokenRepository.save(resetToken);

    await this.mailService.sendPasswordResetEmail(user.email, rawToken);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: {
        tokenHash,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!resetToken || resetToken.usedAt) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.updatePassword(resetToken.userId, passwordHash);

    resetToken.usedAt = new Date();
    await this.passwordResetTokenRepository.save(resetToken);

    // Revoke all existing refresh tokens for this user as a safety measure.
    await this.refreshTokenRepository.update(
      { userId: resetToken.userId },
      { revokedAt: new Date() },
    );
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessExpiresIn = this.configService.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
    ) as string;
    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      jti: crypto.randomUUID(),
    };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn: accessExpiresIn as unknown as number,
    });

    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) as string;
    // A distinct jti per token guarantees the refresh token string itself
    // is always unique, even if issued within the same second (same iat)
    // as another token for this user — otherwise two JWTs with identical
    // claims would be byte-for-byte identical strings, which breaks the
    // "rotate on refresh" security property.
    const refreshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      jti: crypto.randomUUID(),
    };
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn: refreshExpiresIn as unknown as number,
    });

    const tokenHash = this.hashToken(refreshToken);
    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + this.parseTtlMs(refreshExpiresIn)),
    });
    await this.refreshTokenRepository.save(refreshTokenEntity);

    return { accessToken, refreshToken };
  }

  // Parses simple durations like '7d', '15m', '1h' into milliseconds.
  private parseTtlMs(duration: string): number {
    const DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) {
      return DEFAULT_MS;
    }
    const value = parseInt(match[1], 10);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const unitMsMap: Record<'s' | 'm' | 'h' | 'd', number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * unitMsMap[unit];
  }
}
