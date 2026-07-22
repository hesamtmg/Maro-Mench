// Every game engine (Ludo, Snakes & Ladders, future games) implements this
// interface. The gateway and RoomsService only depend on this contract —
// they never know the internal shape of a specific game's board state.

export interface RoomPlayerSeat {
  seatIndex: number;
  userId: string;
  color?: string | null;
}

export interface MoveResult {
  boardState: Record<string, unknown>;
  nextTurnSeat: number;
  isGameOver: boolean;
  winnerSeat?: number;
  movePayload: Record<string, unknown>;
}

export interface RollResult {
  diceValue: number;
  // Some games (Ludo) require the player to then choose which token to move.
  // Others (Snakes & Ladders) can auto-resolve the move right after rolling.
  autoResolved: boolean;
  moveResult?: MoveResult;
}

export interface GameEngine {
  /** Creates the initial board_state for a freshly started game. */
  createInitialState(
    seats: RoomPlayerSeat[],
    rules: Record<string, unknown>,
  ): Record<string, unknown>;

  /** Rolls the dice for the current player and applies auto-resolvable moves. */
  rollDice(
    boardState: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
    rules: Record<string, unknown>,
  ): RollResult;

  /**
   * Applies an explicit move (e.g. choosing which Ludo token to advance)
   * after a dice roll that wasn't auto-resolved.
   */
  applyMove(
    boardState: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
    diceValue: number,
    movePayload: Record<string, unknown>,
    rules: Record<string, unknown>,
  ): MoveResult;

  /** Whether the current player has any legal move at all for this roll. */
  hasLegalMove(
    boardState: Record<string, unknown>,
    seats: RoomPlayerSeat[],
    seatIndex: number,
    diceValue: number,
  ): boolean;
}
