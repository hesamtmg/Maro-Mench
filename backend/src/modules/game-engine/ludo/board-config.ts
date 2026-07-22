// Standard Ludo board layout using a single 0-51 shared outer track,
// with each color having its own entry offset and a private home-stretch
// of 6 squares (52-57) before reaching the center (58 = finished).
//
// This is a simplified but standard representation: 4 tokens per player,
// track length 52 shared squares + 6 home-run squares per color.

export const TRACK_LENGTH = 52;
export const HOME_RUN_LENGTH = 6;
export const FINISHED_POSITION = TRACK_LENGTH + HOME_RUN_LENGTH; // 58
export const TOKENS_PER_PLAYER = 4;

// Entry square (on the shared 0-51 track) for each seat's tokens when they
// leave home, indexed by seatIndex (0=red, 1=green, 2=yellow, 3=blue).
export const ENTRY_OFFSETS: Record<number, number> = {
  0: 0,
  1: 13,
  2: 26,
  3: 39,
};

// Safe squares where tokens cannot be captured (entry squares + star squares).
export const SAFE_SQUARES = new Set<number>([0, 8, 13, 21, 26, 34, 39, 47]);
