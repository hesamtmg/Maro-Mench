import { Module } from '@nestjs/common';
import { ConquestEngine } from './conquest/conquest.engine';
import { GameEngineFactory } from './game-engine.factory';
import { LudoEngine } from './ludo/ludo.engine';
import { MonopolyEngine } from './monopoly/monopoly.engine';
import { OloEngine } from './olo/olo.engine';
import { SnakesLaddersEngine } from './snakes-ladders/snakes-ladders.engine';

@Module({
  providers: [
    LudoEngine,
    SnakesLaddersEngine,
    OloEngine,
    MonopolyEngine,
    ConquestEngine,
    GameEngineFactory,
  ],
  // MonopolyEngine/ConquestEngine are exported (not just LudoEngine/
  // OloEngine/etc, which stay internal) because GameGateway injects them
  // directly for the many game-specific events that fall outside the
  // shared roll/move contract -- see game.gateway.ts.
  exports: [GameEngineFactory, MonopolyEngine, ConquestEngine],
})
export class GameEngineModule {}
