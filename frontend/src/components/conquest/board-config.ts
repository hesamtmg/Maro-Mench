// Mirrors backend/src/modules/game-engine/conquest/board-config.ts exactly
// (territory/continent ids, names, coordinates, adjacency) -- the client
// never invents its own map data. Coordinates are absolute positions in
// the shared 1000x620 map space used by continent-paths.ts, not fractions.

export interface ContinentDef {
  id: string;
  name: string;
  bonus: number;
}

export interface TerritoryDef {
  id: string;
  name: string;
  continentId: string;
  x: number;
  y: number;
}

export const CONTINENTS: ContinentDef[] = [
  { id: 'north_america', name: 'North America', bonus: 5 },
  { id: 'asia', name: 'Asia', bonus: 7 },
  { id: 'africa', name: 'Africa', bonus: 5 },
  { id: 'south_america', name: 'South America', bonus: 4 },
  { id: 'europe', name: 'Europe', bonus: 5 },
  { id: 'oceania', name: 'Oceania', bonus: 3 },
];

export const CONTINENT_COLORS: Record<string, string> = {
  north_america: '#4f8fdb',
  south_america: '#52b788',
  europe: '#e07a5f',
  africa: '#f4a261',
  asia: '#e9c46a',
  oceania: '#9b5de5',
};

export const TERRITORIES: TerritoryDef[] = [
  // North America (7)
  { id: 'icemark', name: 'Icemark', continentId: 'north_america', x: 165.4, y: 101.0 },
  { id: 'glacier_reach', name: 'Glacier Reach', continentId: 'north_america', x: 412.8, y: 78.7 },
  { id: 'frozen_cape', name: 'Frozen Cape', continentId: 'north_america', x: 329.6, y: 137.1 },
  { id: 'tundrafall', name: 'Tundrafall', continentId: 'north_america', x: 239.3, y: 124.7 },
  { id: 'whitepeak', name: 'Whitepeak', continentId: 'north_america', x: 201.7, y: 175.4 },
  { id: 'snowvale', name: 'Snowvale', continentId: 'north_america', x: 277.7, y: 181.9 },
  { id: 'coldharbor', name: 'Coldharbor', continentId: 'north_america', x: 220.3, y: 231.0 },

  // South America (6)
  { id: 'vineholt', name: 'Vineholt', continentId: 'south_america', x: 314.8, y: 286.4 },
  { id: 'canopy_reach', name: 'Canopy Reach', continentId: 'south_america', x: 331.4, y: 315.7 },
  { id: 'mistwood', name: 'Mistwood', continentId: 'south_america', x: 379.9, y: 345.0 },
  { id: 'serpents_delta', name: "Serpent's Delta", continentId: 'south_america', x: 286.9, y: 332.0 },
  { id: 'junglecrown', name: 'Junglecrown', continentId: 'south_america', x: 325.6, y: 364.6 },
  { id: 'verdant_hollow', name: 'Verdant Hollow', continentId: 'south_america', x: 330.0, y: 430.0 },

  // Europe (7)
  { id: 'cinderpeak', name: 'Cinderpeak', continentId: 'europe', x: 492.8, y: 130.9 },
  { id: 'volcarest', name: 'Volcarest', continentId: 'europe', x: 534.0, y: 106.8 },
  { id: 'steppewatch', name: 'Steppewatch', continentId: 'europe', x: 512.5, y: 149.7 },
  { id: 'ironridge', name: 'Ironridge', continentId: 'europe', x: 525.7, y: 168.9 },
  { id: 'blackspire', name: 'Blackspire', continentId: 'europe', x: 548.7, y: 137.1 },
  { id: 'grayridge', name: 'Grayridge', continentId: 'europe', x: 573.9, y: 143.3 },
  { id: 'cragmoor', name: 'Cragmoor', continentId: 'europe', x: 556.5, y: 168.9 },

  // Africa (7)
  { id: 'duneshore', name: 'Duneshore', continentId: 'africa', x: 500.0, y: 208.1 },
  { id: 'emberwaste', name: 'Emberwaste', continentId: 'africa', x: 581.7, y: 221.2 },
  { id: 'sandfall', name: 'Sandfall', continentId: 'africa', x: 541.7, y: 257.1 },
  { id: 'scorchpeak', name: 'Scorchpeak', continentId: 'africa', x: 620.5, y: 279.9 },
  { id: 'oasis_vale', name: 'Oasis Vale', continentId: 'africa', x: 561.8, y: 312.5 },
  { id: 'redrock', name: 'Redrock', continentId: 'africa', x: 601.2, y: 315.7 },
  { id: 'sunspire', name: 'Sunspire', continentId: 'africa', x: 565.0, y: 397.3 },

  // Asia (9)
  { id: 'port_meridian', name: 'Port Meridian', continentId: 'asia', x: 638.1, y: 112.7 },
  { id: 'sunset_bay', name: 'Sunset Bay', continentId: 'asia', x: 794.7, y: 106.8 },
  { id: 'goldshore', name: 'Goldshore', continentId: 'asia', x: 621.1, y: 208.1 },
  { id: 'ashport', name: 'Ashport', continentId: 'asia', x: 669.5, y: 149.7 },
  { id: 'ridgeway', name: 'Ridgeway', continentId: 'asia', x: 714.3, y: 234.3 },
  { id: 'stonebridge', name: 'Stonebridge', continentId: 'asia', x: 777.9, y: 191.7 },
  { id: 'lakehaven', name: 'Lakehaven', continentId: 'asia', x: 786.6, y: 257.1 },
  { id: 'riverrun', name: 'Riverrun', continentId: 'asia', x: 854.5, y: 185.2 },
  { id: 'highmarch', name: 'Highmarch', continentId: 'asia', x: 817.6, y: 312.5 },

  // Oceania (6)
  { id: 'pearl_isle', name: 'Pearl Isle', continentId: 'oceania', x: 832.9, y: 387.5 },
  { id: 'reefhaven', name: 'Reefhaven', continentId: 'oceania', x: 870.5, y: 351.5 },
  { id: 'tideport', name: 'Tideport', continentId: 'oceania', x: 901.1, y: 387.5 },
  { id: 'saltmere', name: 'Saltmere', continentId: 'oceania', x: 865.2, y: 420.2 },
  { id: 'driftcay', name: 'Driftcay', continentId: 'oceania', x: 901.4, y: 325.5 },
  { id: 'stormatoll', name: 'Stormatoll', continentId: 'oceania', x: 944.1, y: 439.8 },
];

const EDGES: Array<[string, string]> = [
  // North America
  ['icemark', 'tundrafall'],
  ['tundrafall', 'frozen_cape'],
  ['frozen_cape', 'glacier_reach'],
  ['tundrafall', 'whitepeak'],
  ['whitepeak', 'snowvale'],
  ['snowvale', 'frozen_cape'],
  ['whitepeak', 'coldharbor'],
  ['snowvale', 'coldharbor'],

  // South America
  ['vineholt', 'canopy_reach'],
  ['vineholt', 'serpents_delta'],
  ['canopy_reach', 'mistwood'],
  ['canopy_reach', 'serpents_delta'],
  ['canopy_reach', 'junglecrown'],
  ['serpents_delta', 'junglecrown'],
  ['mistwood', 'junglecrown'],
  ['junglecrown', 'verdant_hollow'],

  // Europe
  ['cinderpeak', 'steppewatch'],
  ['cinderpeak', 'volcarest'],
  ['volcarest', 'blackspire'],
  ['steppewatch', 'ironridge'],
  ['steppewatch', 'blackspire'],
  ['blackspire', 'grayridge'],
  ['blackspire', 'cragmoor'],
  ['grayridge', 'cragmoor'],
  ['ironridge', 'cragmoor'],

  // Africa
  ['duneshore', 'emberwaste'],
  ['duneshore', 'sandfall'],
  ['emberwaste', 'scorchpeak'],
  ['emberwaste', 'sandfall'],
  ['sandfall', 'oasis_vale'],
  ['sandfall', 'scorchpeak'],
  ['scorchpeak', 'redrock'],
  ['oasis_vale', 'redrock'],
  ['oasis_vale', 'sunspire'],
  ['redrock', 'sunspire'],

  // Asia
  ['port_meridian', 'sunset_bay'],
  ['port_meridian', 'ashport'],
  ['port_meridian', 'goldshore'],
  ['ashport', 'stonebridge'],
  ['ashport', 'ridgeway'],
  ['goldshore', 'ridgeway'],
  ['stonebridge', 'sunset_bay'],
  ['stonebridge', 'ridgeway'],
  ['stonebridge', 'lakehaven'],
  ['stonebridge', 'riverrun'],
  ['sunset_bay', 'riverrun'],
  ['ridgeway', 'lakehaven'],
  ['lakehaven', 'highmarch'],

  // Oceania
  ['pearl_isle', 'reefhaven'],
  ['pearl_isle', 'saltmere'],
  ['reefhaven', 'tideport'],
  ['reefhaven', 'driftcay'],
  ['tideport', 'saltmere'],
  ['tideport', 'stormatoll'],
  ['driftcay', 'tideport'],

  // Inter-continent bottlenecks
  ['icemark', 'sunset_bay'], // Bering Strait
  ['coldharbor', 'vineholt'], // Panama
  ['glacier_reach', 'cinderpeak'], // Greenland - Iceland - Britain
  ['ironridge', 'duneshore'], // Gibraltar
  ['grayridge', 'port_meridian'], // the Urals
  ['cragmoor', 'goldshore'], // the Bosphorus
  ['emberwaste', 'goldshore'], // Suez
  ['highmarch', 'driftcay'], // Indonesia - New Guinea
];

export const TERRITORY_BY_ID: Record<string, TerritoryDef> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t]),
);

export const ADJACENCY: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const t of TERRITORIES) map[t.id] = [];
  for (const [a, b] of EDGES) {
    map[a].push(b);
    map[b].push(a);
  }
  return map;
})();

// Deduplicated, one entry per undirected edge -- what the board actually
// draws as connector lines.
export const EDGE_LIST: Array<[string, string]> = EDGES;

export function areAdjacent(a: string, b: string): boolean {
  return ADJACENCY[a]?.includes(b) ?? false;
}

// Mirrors backend's CARD_DECK exactly -- one card per territory plus two
// wildcards, symbols assigned round-robin so all 42 territories split
// evenly (14 each) across the three generic military-unit symbols.
export type CardSymbol = 'infantry' | 'cavalry' | 'artillery' | 'wild';

export interface CardDef {
  id: string;
  territoryId: string | null;
  symbol: CardSymbol;
}

const CARD_SYMBOLS: readonly CardSymbol[] = ['infantry', 'cavalry', 'artillery'];

export const CARD_DECK: CardDef[] = [
  ...TERRITORIES.map((t, i) => ({
    id: `card_${t.id}`,
    territoryId: t.id,
    symbol: CARD_SYMBOLS[i % 3],
  })),
  { id: 'card_wild_1', territoryId: null, symbol: 'wild' as const },
  { id: 'card_wild_2', territoryId: null, symbol: 'wild' as const },
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARD_DECK.map((c) => [c.id, c]),
);
