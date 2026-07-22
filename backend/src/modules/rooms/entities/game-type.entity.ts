import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum GameTypeCode {
  LUDO = 'ludo',
  SNAKES_LADDERS = 'snakes_ladders',
}

@Entity('game_types')
export class GameType {
  @PrimaryGeneratedColumn('increment', { type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', unique: true })
  code: GameTypeCode;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'smallint', name: 'min_players' })
  minPlayers: number;

  @Column({ type: 'smallint', name: 'max_players' })
  maxPlayers: number;
}
