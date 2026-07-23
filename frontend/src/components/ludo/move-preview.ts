// Pure client-side mirror of the position-transition math in
// backend/src/modules/game-engine/ludo/ludo.engine.ts's applyMove --
// deliberately excludes captures, turn order, and win checks, since this
// is only used to preview where a token *would* land before the player
// confirms a move, not to actually apply one.
import {
  ENTRY_OFFSETS,
  FINISHED_POSITION,
  HOME_RUN_LENGTH,
  TRACK_LENGTH,
} from './board-geometry';

/**
 * Returns the engine position a token would land on if moved by
 * `diceValue`, or null if that move isn't legal (e.g. leaving home
 * without a 6, or overshooting the finish).
 */
export function computeDestinationPosition(
  seatIndex: number,
  position: number,
  diceValue: number,
): number | null {
  if (position === FINISHED_POSITION) return null;

  if (position === -1) {
    if (diceValue !== 6) return null;
    return ENTRY_OFFSETS[seatIndex];
  }

  if (position < TRACK_LENGTH) {
    const entry = ENTRY_OFFSETS[seatIndex];
    const stepsIntoTrack = (position - entry + TRACK_LENGTH) % TRACK_LENGTH;
    const newSteps = stepsIntoTrack + diceValue;
    if (newSteps > TRACK_LENGTH + HOME_RUN_LENGTH - 1) return null;
    if (newSteps >= TRACK_LENGTH) {
      return TRACK_LENGTH + (newSteps - TRACK_LENGTH);
    }
    return (entry + newSteps) % TRACK_LENGTH;
  }

  const newPosition = position + diceValue;
  return newPosition > FINISHED_POSITION ? null : newPosition;
}
