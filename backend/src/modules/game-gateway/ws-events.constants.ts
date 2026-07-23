// Client -> Server events
export const WS_EVENTS_IN = {
  JOIN_ROOM: 'join_room', // { roomId }
  LEAVE_ROOM: 'leave_room', // { roomId }
  PLAYER_READY: 'player_ready', // { roomId }
  START_GAME: 'start_game', // { roomId } (admin only)
  ROLL_DICE: 'roll_dice', // { roomId }
  MAKE_MOVE: 'make_move', // { roomId, tokenId }  (Ludo only, when choice needed)
  KICK_PLAYER: 'kick_player', // { roomId, targetUserId } (admin only)
  DELETE_ROOM: 'delete_room', // { roomId } (admin only)
  JOIN_QUEUE: 'join_queue', // { gameTypeCode, rulesJson? }
  CANCEL_QUEUE: 'cancel_queue', // {}
} as const;

// Server -> Client events
export const WS_EVENTS_OUT = {
  ROOM_STATE: 'room_state', // full room + players snapshot
  ROOM_LIST_UPDATED: 'room_list_updated', // public lobby refresh signal
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_KICKED: 'player_kicked',
  ROOM_DELETED: 'room_deleted', // { roomId } -- room admin deleted the room
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  GAME_STARTED: 'game_started', // initial board_state
  DICE_ROLLED: 'dice_rolled', // { seatIndex, diceValue }
  AWAITING_MOVE_CHOICE: 'awaiting_move_choice', // { seatIndex, diceValue, options }
  MOVE_APPLIED: 'move_applied', // { boardState, nextTurnSeat, movePayload }
  TURN_SKIPPED: 'turn_skipped', // { seatIndex, reason }
  GAME_OVER: 'game_over', // { winnerSeat }
  QUEUE_JOINED: 'queue_joined', // { ticketId }
  QUEUE_CANCELLED: 'queue_cancelled',
  MATCH_FOUND: 'match_found', // { roomId }
  ERROR: 'error_event', // { message }
} as const;
