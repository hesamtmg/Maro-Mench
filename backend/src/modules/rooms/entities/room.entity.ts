import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { GameType } from './game-type.entity';
import { RoomPlayer } from './room-player.entity';

export enum RoomVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
  MATCHMAKING = 'matchmaking',
}

export enum RoomStatus {
  WAITING = 'waiting',
  IN_PROGRESS = 'in_progress',
  FINISHED = 'finished',
  ABANDONED = 'abandoned',
}

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true, where: '"code" IS NOT NULL' })
  @Column({ type: 'varchar', length: 12, nullable: true })
  code?: string | null;

  @ManyToOne(() => GameType, { eager: true })
  @JoinColumn({ name: 'game_type_id' })
  gameType: GameType;

  @Column({ name: 'game_type_id', type: 'smallint' })
  gameTypeId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy?: User | null;

  @Column({ name: 'created_by', nullable: true })
  createdById?: string | null;

  @Column({ type: 'varchar', enum: RoomVisibility })
  visibility: RoomVisibility;

  @Column({ type: 'varchar', enum: RoomStatus, default: RoomStatus.WAITING })
  status: RoomStatus;

  @Column({ type: 'smallint', name: 'max_players' })
  maxPlayers: number;

  @Column({ type: 'jsonb', name: 'rules_json', default: {} })
  rulesJson: Record<string, unknown>;

  @OneToMany(() => RoomPlayer, (rp) => rp.room)
  players: RoomPlayer[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;
}
