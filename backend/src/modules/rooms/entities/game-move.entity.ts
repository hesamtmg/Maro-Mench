import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Room } from './room.entity';

@Entity('game_moves')
export class GameMove {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ name: 'room_id' })
  roomId: string;

  @Column({ type: 'smallint', name: 'seat_index' })
  seatIndex: number;

  @Column({ type: 'integer', name: 'move_number' })
  moveNumber: number;

  @Column({ type: 'smallint', name: 'dice_value', nullable: true })
  diceValue?: number | null;

  @Column({ type: 'jsonb', name: 'move_payload' })
  movePayload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
