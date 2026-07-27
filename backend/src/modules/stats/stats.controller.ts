import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GameTypesService } from '../rooms/game-types.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import {
  serializeGameResult,
  serializeLeaderboardEntry,
  serializeUserGameStats,
} from './serializers/stats.serializer';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly gameTypesService: GameTypesService,
  ) {}

  @Get('me')
  async getMyStats(@CurrentUser() user: CurrentUserPayload) {
    const stats = await this.statsService.getUserStats(user.userId);
    return { stats: stats.map(serializeUserGameStats) };
  }

  @Get('me/history')
  async getMyHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: HistoryQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { results, total } = await this.statsService.getUserHistory(
      user.userId,
      page,
      pageSize,
    );
    return {
      results: results.map((r) => serializeGameResult(r, user.userId)),
      total,
      page,
      pageSize,
    };
  }

  @Get('leaderboard')
  async getLeaderboard(@Query() query: LeaderboardQueryDto) {
    const gameType = await this.gameTypesService.findByCode(query.gameTypeCode);
    if (!gameType) {
      throw new NotFoundException('Unknown game type');
    }
    const limit = query.limit ?? 20;
    const entries = await this.statsService.getLeaderboard(gameType.id, limit);
    return {
      gameType: { code: gameType.code, name: gameType.name },
      entries: entries.map((e, i) => serializeLeaderboardEntry(e, i + 1)),
    };
  }
}
