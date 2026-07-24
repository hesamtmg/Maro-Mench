// Mirrors the disc generation constants from the original flick-arena
// prototype exactly, so server-generated discs feel identical to the
// original single-device game. Everything is expressed as a fraction of
// board width/height (not pixels), since the two clients in an online
// match may render the board at different physical sizes.

export const DISC_R_MIN = 0.02;
export const DISC_R_MAX = 0.068;
export const DENSITY_MIN = 0.0006;
export const DENSITY_MAX = 0.0034;
export const DISCS_PER_PLAYER = 6;
export const MAX_USES = 3;

// Fraction of board HEIGHT each end's "free" (staging) zone occupies.
export const ZONE_FREE_H = 0.1;
// Fraction of board HEIGHT each end's "drop" (scoring) zone occupies,
// immediately inside the free zone.
export const ZONE_DROP_H = 0.14;
