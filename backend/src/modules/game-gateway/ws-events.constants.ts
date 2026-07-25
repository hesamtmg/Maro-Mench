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
  // OLO is real-time physics (drag-and-flick), not discrete dice/moves --
  // it bypasses ROLL_DICE/MAKE_MOVE entirely. The shooting client runs
  // Matter.js locally and relays positions + the final result directly.
  OLO_LIVE_POSITIONS: 'olo_live_positions', // { roomId, positions: [{id,x,y}] } -- ephemeral, not persisted
  OLO_SHOT_RESULT: 'olo_shot_result', // { roomId, boardState, nextTurnSeat, isGameOver, winnerSeat? }
  // Monopoly-only: these fall outside the shared roll/move contract (a
  // purchase decision isn't a "move", and building/paying-out-of-jail
  // don't consume a turn), so they get their own dedicated events.
  MONOPOLY_PURCHASE_DECISION: 'monopoly_purchase_decision', // { roomId, buy }
  MONOPOLY_BUILD_HOUSE: 'monopoly_build_house', // { roomId, spaceIndex }
  MONOPOLY_PAY_JAIL_FINE: 'monopoly_pay_jail_fine', // { roomId }
  // Auctions/trades aren't gated to whoever's turn it is -- any active
  // (non-bankrupt) player can bid or trade regardless of currentTurnSeat.
  MONOPOLY_PLACE_BID: 'monopoly_place_bid', // { roomId, amount }
  MONOPOLY_PASS_AUCTION: 'monopoly_pass_auction', // { roomId }
  MONOPOLY_PROPOSE_TRADE: 'monopoly_propose_trade', // { roomId, toSeat, offerCash, offerProperties, offerJailCards, requestCash, requestProperties, requestJailCards }
  MONOPOLY_RESPOND_TRADE: 'monopoly_respond_trade', // { roomId, tradeId, accept }
  MONOPOLY_MORTGAGE: 'monopoly_mortgage', // { roomId, spaceIndex }
  MONOPOLY_UNMORTGAGE: 'monopoly_unmortgage', // { roomId, spaceIndex }
  MONOPOLY_SELL_HOUSE: 'monopoly_sell_house', // { roomId, spaceIndex }
  MONOPOLY_PAY_DEBT: 'monopoly_pay_debt', // { roomId }
  MONOPOLY_DECLARE_BANKRUPTCY: 'monopoly_declare_bankruptcy', // { roomId }
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
  TURN_SKIPPED: 'turn_skipped', // { seatIndex, reason, nextTurnSeat }
  GAME_OVER: 'game_over', // { winnerSeat }
  QUEUE_JOINED: 'queue_joined', // { ticketId }
  QUEUE_CANCELLED: 'queue_cancelled',
  MATCH_FOUND: 'match_found', // { roomId }
  ERROR: 'error_event', // { message }
  OLO_LIVE_POSITIONS: 'olo_live_positions', // relayed to the other player only
  OLO_SHOT_RESULT: 'olo_shot_result', // broadcast to the whole room
  MONOPOLY_STATE_UPDATED: 'monopoly_state_updated', // { boardState } -- build-house / pay-jail-fine, no turn change
} as const;
