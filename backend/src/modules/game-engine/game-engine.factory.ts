import { Injectable } from '@nestjs/common';
import { GameTypeCode } from '../rooms/entities/game-type.entity';
import { ConquestEngine } from './conquest/conquest.engine';
import { GameEngine } from './game-engine.interface';
import { LudoEngine } from './ludo/ludo.engine';
import { MonopolyEngine } from './monopoly/monopoly.engine';
import { OloEngine } from './olo/olo.engine';
import { SnakesLaddersEngine } from './snakes-ladders/snakes-ladders.engine';

@Injectable()
export class GameEngineFactory {
  constructor(
    private readonly ludoEngine: LudoEngine,
    private readonly snakesLaddersEngine: SnakesLaddersEngine,
    private readonly oloEngine: OloEngine,
    private readonly monopolyEngine: MonopolyEngine,
    private readonly conquestEngine: ConquestEngine,
  ) {}

  getEngine(gameTypeCode: GameTypeCode): GameEngine {
    switch (gameTypeCode) {
      case GameTypeCode.LUDO:
        return this.ludoEngine;
      case GameTypeCode.SNAKES_LADDERS:
        return this.snakesLaddersEngine;
      case GameTypeCode.OLO:
        return this.oloEngine;
      case GameTypeCode.MONOPOLY:
        return this.monopolyEngine;
      case GameTypeCode.CONQUEST:
        return this.conquestEngine;
      default:
        throw new Error(
          `No game engine registered for ${String(gameTypeCode)}`,
        );
    }
  }
}
