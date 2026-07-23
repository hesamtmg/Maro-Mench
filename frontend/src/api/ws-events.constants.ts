// Mirrors backend/src/modules/game-gateway/ws-events.constants.ts
// Keep these two files in sync manually (or extract to a shared package
// later if the monorepo grows).

export const WS_EVENTS_IN = {
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  PLAYER_READY: 'player_ready',
  START_GAME: 'start_game',
  ROLL_DICE: 'roll_dice',
  MAKE_MOVE: 'make_move',
  KICK_PLAYER: 'kick_player',
  DELETE_ROOM: 'delete_room',
  JOIN_QUEUE: 'join_queue',
  CANCEL_QUEUE: 'cancel_queue',
} as const;

export const WS_EVENTS_OUT = {
  ROOM_STATE: 'room_state',
  ROOM_LIST_UPDATED: 'room_list_updated',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_KICKED: 'player_kicked',
  ROOM_DELETED: 'room_deleted',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  GAME_STARTED: 'game_started',
  DICE_ROLLED: 'dice_rolled',
  AWAITING_MOVE_CHOICE: 'awaiting_move_choice',
  MOVE_APPLIED: 'move_applied',
  TURN_SKIPPED: 'turn_skipped',
  GAME_OVER: 'game_over',
  QUEUE_JOINED: 'queue_joined',
  QUEUE_CANCELLED: 'queue_cancelled',
  MATCH_FOUND: 'match_found',
  ERROR: 'error_event',
} as const;
