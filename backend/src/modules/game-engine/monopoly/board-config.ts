// Original 40-space property-trading board. Names, layout, and numbers are
// original to this project (not reproduced from any commercial board) --
// the well-known "buy properties around a loop, pay rent, build houses"
// mechanic itself isn't anyone's IP, but the specific names/art are, so
// everything here is invented from scratch.

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
    houseCost: HOUSE_COST_BY_GROUP[group] ?? 100,
  };
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

export type CardEffect =
  | { type: 'collect'; amount: number; text: string }
  | { type: 'pay'; amount: number; text: string }
  | { type: 'advance_to_go'; text: string }
  | { type: 'go_to_jail'; text: string }
  | { type: 'get_out_of_jail_free'; text: string };

export const CHANCE_CARDS: CardEffect[] = [
  { type: 'collect', amount: 150, text: 'Investment pays off. Collect $150.' },
  { type: 'pay', amount: 100, text: 'Repair bill due. Pay $100.' },
  { type: 'advance_to_go', text: 'Advance to Go. Collect $200.' },
  { type: 'go_to_jail', text: 'Go directly to Jail.' },
  {
    type: 'get_out_of_jail_free',
    text: 'Get out of Jail free. Keep this card.',
  },
  { type: 'collect', amount: 50, text: 'Lucky find. Collect $50.' },
  { type: 'pay', amount: 50, text: 'Speeding fine. Pay $50.' },
];

export const CHEST_CARDS: CardEffect[] = [
  { type: 'collect', amount: 100, text: 'Bank error in your favor. Collect $100.' },
  { type: 'pay', amount: 100, text: 'Medical bill. Pay $100.' },
  { type: 'collect', amount: 200, text: 'Inheritance. Collect $200.' },
  { type: 'pay', amount: 50, text: 'School fees. Pay $50.' },
  { type: 'advance_to_go', text: 'Advance to Go. Collect $200.' },
  { type: 'go_to_jail', text: 'Go directly to Jail.' },
  {
    type: 'get_out_of_jail_free',
    text: 'Get out of Jail free. Keep this card.',
  },
  { type: 'collect', amount: 25, text: 'Tax refund. Collect $25.' },
];

export const STARTING_CASH = 1500;
export const GO_BONUS = 200;
export const JAIL_FINE = 50;
export const JAIL_SPACE_INDEX = 10;
export const HOTEL_LEVEL = 5;
export const MAX_JAIL_TURNS = 3;
