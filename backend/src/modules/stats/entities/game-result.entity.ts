import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GameType } from '../../rooms/entities/game-type.entity';
import { Room } from '../../rooms/entities/room.entity';
import { User } from '../../users/entities/user.entity';

export interface GameResultPlayer {
  userId: string;
  seatIndex: number;
  isWinner: boolean;
}

// One row per finished game, written once by StatsService.recordGameResult
// when finishGame() runs. players is a snapshot of who was seated and who
// won -- kept even if a user is later deleted (userId only, no join
// required to read history), separate from the live/mutable Room roster.
@Entity('game_results')
export class GameResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ name: 'room_id', unique: true })
  roomId: string;

  @ManyToOne(() => GameType, { eager: true })
  @JoinColumn({ name: 'game_type_id' })
  gameType: GameType;

  @Index()
  @Column({ name: 'game_type_id', type: 'smallint' })
  gameTypeId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'winner_user_id' })
  winner?: User | null;

  @Column({ name: 'winner_user_id', nullable: true })
  winnerUserId?: string | null;

  @Column({ type: 'jsonb' })
  players: GameResultPlayer[];

  @Column({ name: 'finished_at', type: 'timestamptz' })
  finishedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
