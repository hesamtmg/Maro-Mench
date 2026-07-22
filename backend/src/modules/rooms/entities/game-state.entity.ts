import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Room } from './room.entity';

@Entity('game_states')
export class GameState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ name: 'room_id', unique: true })
  roomId: string;

  @Column({ type: 'smallint', name: 'current_turn_seat' })
  currentTurnSeat: number;

  // Shape depends on game type; interpreted by the matching game engine module.
  @Column({ type: 'jsonb', name: 'board_state' })
  boardState: Record<string, unknown>;

  @Column({ type: 'integer', name: 'turn_number', default: 0 })
  turnNumber: number;

  @Column({ type: 'smallint', name: 'last_roll', nullable: true })
  lastRoll?: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
