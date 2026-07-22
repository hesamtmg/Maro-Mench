import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Room } from './room.entity';

export enum RoomPlayerStatus {
  JOINED = 'joined',
  READY = 'ready',
  LEFT = 'left',
  DISCONNECTED = 'disconnected',
  KICKED = 'kicked',
}

@Entity('room_players')
export class RoomPlayer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, (room) => room.players, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ name: 'room_id' })
  roomId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'smallint', name: 'seat_index' })
  seatIndex: number;

  @Column({ type: 'varchar', nullable: true })
  color?: string | null;

  @Column({
    type: 'varchar',
    enum: RoomPlayerStatus,
    default: RoomPlayerStatus.JOINED,
  })
  status: RoomPlayerStatus;

  @Column({ type: 'boolean', name: 'is_admin', default: false })
  isAdmin: boolean;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;
}
