import { Module } from '@nestjs/common';
import { GameEngineFactory } from './game-engine.factory';
import { LudoEngine } from './ludo/ludo.engine';
import { OloEngine } from './olo/olo.engine';
import { SnakesLaddersEngine } from './snakes-ladders/snakes-ladders.engine';

@Module({
  providers: [LudoEngine, SnakesLaddersEngine, OloEngine, GameEngineFactory],
  exports: [GameEngineFactory],
})
export class GameEngineModule {}
