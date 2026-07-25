// Mirrors backend/src/modules/game-engine/monopoly/board-config.ts (names,
// groups, prices) -- only what's needed to render the board client-side.
// Actual rent charged during play still always comes from the server
// (movePayload/boardState), never recomputed here -- `rent` below is only
// for showing the printed title-deed card, and is a pure function of
// `price` mirroring the backend's own rentTable() exactly, so the numbers
// shown always match what the server would actually charge.

import anchorIcon from '../../assets/tokens/anchor.svg';
import bootIcon from '../../assets/tokens/boot.svg';
import carIcon from '../../assets/tokens/car.svg';
import catIcon from '../../assets/tokens/cat.svg';
import dogIcon from '../../assets/tokens/dog.svg';
import hatIcon from '../../assets/tokens/hat.svg';
import penguinIcon from '../../assets/tokens/penguin.svg';
import shipIcon from '../../assets/tokens/ship.svg';

export type MonopolySpaceType =
  | 'go'
  | 'property'
  | 'transit'
  | 'utility'
  | 'tax'
  | 'chest'
  | 'chance'
  | 'jail'
  | 'free_parking'
  | 'go_to_jail';

export interface MonopolySpace {
  index: number;
  type: MonopolySpaceType;
  name: string;
  group?: string;
  price?: number;
  // [base, 1 house, 2 houses, 3 houses, 4 houses, hotel] -- property only.
  rent?: number[];
  houseCost?: number;
  taxAmount?: number;
  // Real artwork path, filled in later. Until then the board renders a
  // procedural placeholder background instead (see tierFor/watermarkFor).
  bgImage?: string;
}

export const GROUP_COLORS: Record<string, string> = {
  A: '#8b5a2b',
  B: '#7ec8e3',
  C: '#e0559e',
  D: '#f0932b',
  E: '#eb4d4b',
  F: '#f6e58d',
  G: '#38ac6a',
  H: '#3455db',
};

const HOUSE_COST_BY_GROUP: Record<string, number> = {
  A: 50,
  B: 50,
  C: 100,
  D: 100,
  E: 150,
  F: 150,
  G: 200,
  H: 200,
};

function rentTable(price: number): number[] {
  const round = (n: number) => Math.round(n / 2) * 2;
  return [
    round(price * 0.06),
    round(price * 0.3),
    round(price * 0.9),
    round(price * 2.0),
    round(price * 2.8),
    round(price * 3.6),
  ];
}

function property(
  index: number,
  name: string,
  group: string,
  price: number,
): MonopolySpace {
  return {
    index,
    type: 'property',
    name,
    group,
    price,
    rent: rentTable(price),
    houseCost: HOUSE_COST_BY_GROUP[group],
  };
}

export const BOARD: MonopolySpace[] = [
  { index: 0, type: 'go', name: 'Go' },
  property(1, 'Molavi', 'A', 60),
  { index: 2, type: 'chest', name: 'Fortune Chest' },
  property(3, 'Khazaneh', 'A', 60),
  { index: 4, type: 'tax', name: 'Income Tax', taxAmount: 200 },
  { index: 5, type: 'transit', name: 'Central Station', price: 200 },
  property(6, 'Naziabad', 'B', 100),
  { index: 7, type: 'chance', name: 'Wildcard' },
  property(8, 'Javadieh', 'B', 100),
  property(9, 'Shoosh', 'B', 120),
  { index: 10, type: 'jail', name: 'Jail / Just Visiting' },
  property(11, 'Piroozi', 'C', 140),
  { index: 12, type: 'utility', name: 'Power Plant', price: 150 },
  property(13, 'Nezamabad', 'C', 140),
  property(14, 'Baharestan', 'C', 160),
  { index: 15, type: 'transit', name: 'North Station', price: 200 },
  property(16, 'Yousefabad', 'D', 180),
  { index: 17, type: 'chest', name: 'Fortune Chest' },
  property(18, 'Gisha', 'D', 180),
  property(19, 'Amirabad', 'D', 200),
  { index: 20, type: 'free_parking', name: 'Free Parking' },
  property(21, 'Punak', 'E', 220),
  { index: 22, type: 'chance', name: 'Wildcard' },
  property(23, 'Sattarkhan', 'E', 220),
  property(24, 'Marzdaran', 'E', 240),
  { index: 25, type: 'transit', name: 'East Station', price: 200 },
  property(26, 'Saadat Abad', 'F', 260),
  property(27, 'Shahrak-e Gharb', 'F', 260),
  { index: 28, type: 'utility', name: 'Water Works', price: 150 },
  property(29, 'Jordan', 'F', 280),
  { index: 30, type: 'go_to_jail', name: 'Go To Jail' },
  property(31, 'Farmanieh', 'G', 300),
  property(32, 'Zaferanieh', 'G', 300),
  { index: 33, type: 'chest', name: 'Fortune Chest' },
  property(34, 'Elahieh', 'G', 320),
  { index: 35, type: 'transit', name: 'South Station', price: 200 },
  { index: 36, type: 'chance', name: 'Wildcard' },
  property(37, 'Niavaran', 'H', 350),
  { index: 38, type: 'tax', name: 'Luxury Tax', taxAmount: 100 },
  property(39, 'Fereshteh', 'H', 400),
];

export const JAIL_SPACE_INDEX = 10;
export const HOTEL_LEVEL = 5;

// Once real art exists this is the only thing a tile needs -- backgroundStyleFor
// falls back to the classic-board CSS look (cream card + group color band)
// when bgImage is unset.
export function backgroundStyleFor(space: MonopolySpace): Record<string, string> | undefined {
  if (!space.bgImage) return undefined;
  return {
    backgroundImage: `url(${space.bgImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

const SPACE_ICONS: Partial<Record<MonopolySpaceType, string>> = {
  go: '➡️',
  jail: '🚔',
  free_parking: '🅿️',
  go_to_jail: '👮',
  chance: '❓',
  chest: '🎁',
  tax: '💸',
  transit: '🚉',
  utility: '💡',
};

export function iconFor(space: MonopolySpace): string {
  return SPACE_ICONS[space.type] ?? '';
}

// Classic-style playing pieces, one per seat -- original simple silhouette
// icons (not any specific game's actual token art), cycled by seatIndex
// so it works for any player count up to the room's max. Returns an
// image URL (resolved by Vite's asset pipeline) rather than a glyph, so
// every call site renders it via <img :src="tokenIconForSeat(...)">.
export const PLAYER_TOKEN_ICONS = [
  carIcon,
  hatIcon,
  dogIcon,
  bootIcon,
  shipIcon,
  catIcon,
  penguinIcon,
  anchorIcon,
];

export function tokenIconForSeat(seatIndex: number): string {
  return PLAYER_TOKEN_ICONS[seatIndex % PLAYER_TOKEN_ICONS.length];
}
