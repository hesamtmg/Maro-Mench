import { Module } from '@nestjs/common';
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
    GameEngineFactory,
  ],
  // MonopolyEngine is exported (not just LudoEngine/OloEngine/etc, which
  // stay internal) because GameGateway injects it directly for the
  // purchase-decision/build-house/pay-jail-fine events that fall outside
  // the shared roll/move contract -- see game.gateway.ts.
  exports: [GameEngineFactory, MonopolyEngine],
})
export class GameEngineModule {}
