import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomByCodeDto } from './dto/join-room-by-code.dto';
import { RoomListQueryDto } from './dto/room-list-query.dto';
import { RoomsService } from './rooms.service';
import {
  serializeRoomForResponse,
  serializeRoomListForResponse,
} from './serializers/room.serializer';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  async createRoom(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateRoomDto,
  ) {
    const room = await this.roomsService.createRoom({
      gameTypeCode: dto.gameTypeCode,
      visibility: dto.visibility,
      maxPlayers: dto.maxPlayers,
      rulesJson: dto.rulesJson,
      createdByUserId: user.userId,
    });
    return serializeRoomForResponse(room);
  }

  @Get()
  async listPublicRooms(@Query() query: RoomListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { rooms, total } = await this.roomsService.listPublicRooms(
      query.gameTypeCode,
      page,
      pageSize,
    );
    return {
      rooms: serializeRoomListForResponse(rooms),
      total,
      page,
      pageSize,
    };
  }

  @Get(':id')
  async getRoom(@Param('id') id: string) {
    const room = await this.roomsService.findRoomOrThrow(id);
    return serializeRoomForResponse(room);
  }

  @Post('join-by-code')
  async joinByCode(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: JoinRoomByCodeDto,
  ) {
    const room = await this.roomsService.joinRoomByCode(dto.code, user.userId);
    return serializeRoomForResponse(room);
  }

  @Post(':id/join')
  async joinById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const room = await this.roomsService.joinRoomById(id, user.userId);
    return serializeRoomForResponse(room);
  }

  @Post(':id/leave')
  async leaveRoom(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const room = await this.roomsService.leaveRoom(id, user.userId);
    return serializeRoomForResponse(room);
  }

  @Delete(':id/players/:userId')
  async kickPlayer(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    const room = await this.roomsService.kickPlayer(
      id,
      user.userId,
      targetUserId,
    );
    return serializeRoomForResponse(room);
  }
}
