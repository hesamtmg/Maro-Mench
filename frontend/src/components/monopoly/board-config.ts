// Mirrors backend/src/modules/game-engine/monopoly/board-config.ts (names,
// groups, prices) -- only what's needed to render the board client-side.
// Rent tables aren't duplicated here; rent amounts arrive from the server
// in movePayload/boardState instead of being recomputed on the client.

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

function property(
  index: number,
  name: string,
  group: string,
  price: number,
): MonopolySpace {
  return { index, type: 'property', name, group, price, houseCost: HOUSE_COST_BY_GROUP[group] };
}

export const BOARD: MonopolySpace[] = [
  { index: 0, type: 'go', name: 'Go' },
  property(1, 'Elm Row', 'A', 60),
  { index: 2, type: 'chest', name: 'Fortune Chest' },
  property(3, 'Birch Row', 'A', 60),
  { index: 4, type: 'tax', name: 'Income Tax', taxAmount: 200 },
  { index: 5, type: 'transit', name: 'Central Station', price: 200 },
  property(6, 'Harbor Lane', 'B', 100),
  { index: 7, type: 'chance', name: 'Wildcard' },
  property(8, 'Coral Lane', 'B', 100),
  property(9, 'Bayview Lane', 'B', 120),
  { index: 10, type: 'jail', name: 'Jail / Just Visiting' },
  property(11, 'Magnolia Ave', 'C', 140),
  { index: 12, type: 'utility', name: 'Power Plant', price: 150 },
  property(13, 'Camellia Ave', 'C', 140),
  property(14, 'Jasmine Ave', 'C', 160),
  { index: 15, type: 'transit', name: 'North Station', price: 200 },
  property(16, 'Amber Court', 'D', 180),
  { index: 17, type: 'chest', name: 'Fortune Chest' },
  property(18, 'Copper Court', 'D', 180),
  property(19, 'Bronze Court', 'D', 200),
  { index: 20, type: 'free_parking', name: 'Free Parking' },
  property(21, 'Ruby Street', 'E', 220),
  { index: 22, type: 'chance', name: 'Wildcard' },
  property(23, 'Garnet Street', 'E', 220),
  property(24, 'Scarlet Street', 'E', 240),
  { index: 25, type: 'transit', name: 'East Station', price: 200 },
  property(26, 'Lemon Blvd', 'F', 260),
  property(27, 'Citrus Blvd', 'F', 260),
  { index: 28, type: 'utility', name: 'Water Works', price: 150 },
  property(29, 'Golden Blvd', 'F', 280),
  { index: 30, type: 'go_to_jail', name: 'Go To Jail' },
  property(31, 'Cedar Park', 'G', 300),
  property(32, 'Willow Park', 'G', 300),
  { index: 33, type: 'chest', name: 'Fortune Chest' },
  property(34, 'Maple Park', 'G', 320),
  { index: 35, type: 'transit', name: 'South Station', price: 200 },
  { index: 36, type: 'chance', name: 'Wildcard' },
  property(37, 'Sapphire Heights', 'H', 350),
  { index: 38, type: 'tax', name: 'Luxury Tax', taxAmount: 100 },
  property(39, 'Diamond Heights', 'H', 400),
];

export const JAIL_SPACE_INDEX = 10;
export const HOTEL_LEVEL = 5;

// Economic tier per property group, poorest (1) to richest (4) -- mirrors
// the existing house-cost tiers, just relabeled for background theming.
const TIER_BY_GROUP: Record<string, number> = {
  A: 1,
  B: 1,
  C: 2,
  D: 2,
  E: 3,
  F: 3,
  G: 4,
  H: 4,
};

export function tierFor(space: MonopolySpace): number | null {
  return space.group ? TIER_BY_GROUP[space.group] ?? null : null;
}

// Placeholder watermark art, shown until real per-tile images are dropped
// in via `bgImage`. Tiers run shack -> cottage -> villa -> mansion;
// non-property spaces get an icon matching their function.
const TIER_WATERMARKS: Record<number, string> = {
  1: '🏚️',
  2: '🏠',
  3: '🏡',
  4: '🏰',
};

const TYPE_WATERMARKS: Partial<Record<MonopolySpaceType, string>> = {
  go: '🏁',
  jail: '🔒',
  transit: '🚆',
  utility: '⚡',
  tax: '🧾',
  chest: '💰',
  chance: '🌀',
  free_parking: '🌳',
  go_to_jail: '🚨',
};

export function watermarkFor(space: MonopolySpace): string {
  const tier = tierFor(space);
  if (tier) return TIER_WATERMARKS[tier];
  return TYPE_WATERMARKS[space.type] ?? '';
}

// Once real art exists this is the only thing a tile needs -- backgroundStyleFor
// falls back to the CSS mock (tier-N / type-X classes) when bgImage is unset.
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

// Classic-style playing pieces, one per seat -- generic emoji, not any
// specific game's actual token art, cycled by seatIndex so it works for
// any player count up to the room's max.
export const PLAYER_TOKEN_ICONS = ['🚗', '🎩', '🐕', '👞', '🚢', '🐈', '🐧', '⚓'];

export function tokenIconForSeat(seatIndex: number): string {
  return PLAYER_TOKEN_ICONS[seatIndex % PLAYER_TOKEN_ICONS.length];
}
