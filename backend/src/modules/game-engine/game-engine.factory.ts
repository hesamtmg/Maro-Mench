import { Injectable } from '@nestjs/common';
import { GameTypeCode } from '../rooms/entities/game-type.entity';
import { GameEngine } from './game-engine.interface';
import { LudoEngine } from './ludo/ludo.engine';
import { SnakesLaddersEngine } from './snakes-ladders/snakes-ladders.engine';

@Injectable()
export class GameEngineFactory {
  constructor(
    private readonly ludoEngine: LudoEngine,
    private readonly snakesLaddersEngine: SnakesLaddersEngine,
  ) {}

  getEngine(gameTypeCode: GameTypeCode): GameEngine {
    switch (gameTypeCode) {
      case GameTypeCode.LUDO:
        return this.ludoEngine;
      case GameTypeCode.SNAKES_LADDERS:
        return this.snakesLaddersEngine;
      default:
        throw new Error(
          `No game engine registered for ${String(gameTypeCode)}`,
        );
    }
  }
}
