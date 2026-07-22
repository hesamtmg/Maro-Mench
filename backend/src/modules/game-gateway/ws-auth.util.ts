import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    email: string;
  };
}

export async function authenticateSocket(
  socket: Socket,
  jwtService: JwtService,
  configService: ConfigService,
): Promise<{ userId: string; email: string }> {
  const token =
    (socket.handshake.auth?.token as string | undefined) ??
    socket.handshake.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    throw new UnauthorizedException('Missing auth token');
  }

  try {
    const payload = await jwtService.verifyAsync<JwtPayload>(token, {
      secret: configService.get<string>('JWT_ACCESS_SECRET'),
    });
    return { userId: payload.sub, email: payload.email };
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}
