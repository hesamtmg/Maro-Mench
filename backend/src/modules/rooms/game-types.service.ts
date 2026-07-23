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
