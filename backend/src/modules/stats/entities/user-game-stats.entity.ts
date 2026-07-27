import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GameType } from '../../rooms/entities/game-type.entity';
import { User } from '../../users/entities/user.entity';

// One row per (user, game type), upserted by StatsService.recordGameResult
// whenever a game of that type finishes with this user seated in it.
@Entity('user_game_stats')
export class UserGameStats {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @PrimaryColumn({ name: 'game_type_id', type: 'smallint' })
  gameTypeId: number;

  @ManyToOne(() => GameType, { eager: true })
  @JoinColumn({ name: 'game_type_id' })
  gameType: GameType;

  @Column({ name: 'games_played', type: 'integer', default: 0 })
  gamesPlayed: number;

  @Column({ type: 'integer', default: 0 })
  wins: number;

  @Column({ type: 'integer', default: 0 })
  losses: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
