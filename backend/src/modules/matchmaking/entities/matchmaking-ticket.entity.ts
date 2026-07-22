import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { GameType } from '../../rooms/entities/game-type.entity';
import { Room } from '../../rooms/entities/room.entity';

export enum MatchmakingTicketStatus {
  QUEUED = 'queued',
  MATCHED = 'matched',
  CANCELLED = 'cancelled',
}

@Entity('matchmaking_tickets')
export class MatchmakingTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => GameType)
  @JoinColumn({ name: 'game_type_id' })
  gameType: GameType;

  @Column({ name: 'game_type_id', type: 'smallint' })
  gameTypeId: number;

  @Column({ type: 'jsonb', name: 'rules_json', default: {} })
  rulesJson: Record<string, unknown>;

  @Column({
    type: 'varchar',
    enum: MatchmakingTicketStatus,
    default: MatchmakingTicketStatus.QUEUED,
  })
  status: MatchmakingTicketStatus;

  @ManyToOne(() => Room, { nullable: true })
  @JoinColumn({ name: 'matched_room_id' })
  matchedRoom?: Room | null;

  @Column({ name: 'matched_room_id', nullable: true })
  matchedRoomId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
