import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameType, GameTypeCode } from './entities/game-type.entity';

const DEFAULT_GAME_TYPES: Array<Omit<GameType, 'id'>> = [
  {
    code: GameTypeCode.LUDO,
    name: 'Ludo',
    minPlayers: 2,
    maxPlayers: 4,
  },
  {
    code: GameTypeCode.SNAKES_LADDERS,
    name: 'Snakes & Ladders',
    minPlayers: 2,
    maxPlayers: 16,
  },
  {
    code: GameTypeCode.OLO,
    name: 'OLO',
    minPlayers: 2,
    maxPlayers: 2,
  },
  {
    code: GameTypeCode.MONOPOLY,
    name: 'Monopoly',
    minPlayers: 2,
    maxPlayers: 6,
  },
];

@Injectable()
export class GameTypesService implements OnModuleInit {
  private readonly logger = new Logger(GameTypesService.name);

  constructor(
    @InjectRepository(GameType)
    private readonly gameTypeRepository: Repository<GameType>,
  ) {}

  async onModuleInit() {
    for (const gameType of DEFAULT_GAME_TYPES) {
      const existing = await this.gameTypeRepository.findOne({
        where: { code: gameType.code },
      });
      if (!existing) {
        await this.gameTypeRepository.save(
          this.gameTypeRepository.create(gameType),
        );
        this.logger.log(`Seeded game type: ${gameType.code}`);
      } else if (existing.name !== gameType.name) {
        // Keeps an already-seeded row's display name in sync with a
        // later rename here (e.g. Tycoon -> Monopoly) instead of only
        // ever applying on first insert.
        existing.name = gameType.name;
        await this.gameTypeRepository.save(existing);
        this.logger.log(
          `Renamed game type ${gameType.code} to "${gameType.name}"`,
        );
      }
    }
  }

  findByCode(code: GameTypeCode): Promise<GameType | null> {
    return this.gameTypeRepository.findOne({ where: { code } });
  }

  findAll(): Promise<GameType[]> {
    return this.gameTypeRepository.find();
  }
}
