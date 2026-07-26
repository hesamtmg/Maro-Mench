// A 42-territory world map, accurately laid out to match real-world
// geography (continent shapes/positions are generated from public-domain
// Natural Earth geographic data, not traced from any commercial game's
// artwork). Territory names are real/historic place names (Albion, Gaul,
// Cathay, Nippon, ...) chosen specifically to differ from Risk's actual
// 42-name list, and the subdivision/adjacency scheme (which regions exist,
// their boundaries, how many per continent) is this project's own, not a
// reproduction of Risk's specific 42-territory carve-up.

export interface ContinentDef {
  id: string;
  name: string;
  // Bonus reinforcement armies awarded each turn for owning every
  // territory in the continent -- roughly scaled by size and how many
  // inter-continent bottlenecks it has to defend (more borders to hold =
  // bigger bonus to compensate).
  bonus: number;
}

export interface TerritoryDef {
  id: string;
  name: string;
  continentId: string;
  // Absolute position in the shared 1000x620 map coordinate space (same
  // projection used for the continent coastline paths on the frontend),
  // not a 0-1 fraction.
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

export const CONTINENT_BY_ID: Record<string, ContinentDef> = Object.fromEntries(
  CONTINENTS.map((c) => [c.id, c]),
);

export const TERRITORIES: TerritoryDef[] = [
  // North America (7)
  { id: 'icemark', name: "Bering Coast", continentId: 'north_america', x: 180.61, y: 110.37 },
  { id: 'glacier_reach', name: "Thule", continentId: 'north_america', x: 417.63, y: 79.43 },
  { id: 'frozen_cape', name: "Labrador Coast", continentId: 'north_america', x: 334.95, y: 139.08 },
  { id: 'tundrafall', name: "Yukon Basin", continentId: 'north_america', x: 248.58, y: 129.77 },
  { id: 'whitepeak', name: "Sierra Range", continentId: 'north_america', x: 207.36, y: 180.18 },
  { id: 'snowvale', name: "Appalachia", continentId: 'north_america', x: 281.46, y: 184.43 },
  { id: 'coldharbor', name: "Sierra Madre", continentId: 'north_america', x: 222.16, y: 233.46 },

  // South America (6)
  { id: 'vineholt', name: "Orinoco Basin", continentId: 'south_america', x: 314.85, y: 286.77 },
  { id: 'canopy_reach', name: "Amazon Delta", continentId: 'south_america', x: 331.38, y: 315.65 },
  { id: 'mistwood', name: "Bahia Coast", continentId: 'south_america', x: 380.06, y: 344.81 },
  { id: 'serpents_delta', name: "Andes Coast", continentId: 'south_america', x: 287.06, y: 331.59 },
  { id: 'junglecrown', name: "Gran Chaco", continentId: 'south_america', x: 326.09, y: 363.93 },
  { id: 'verdant_hollow', name: "Pampas", continentId: 'south_america', x: 332.53, y: 428.64 },

  // Europe (7)
  { id: 'cinderpeak', name: "Albion", continentId: 'europe', x: 493.03, y: 130.87 },
  { id: 'volcarest', name: "Fjordlands", continentId: 'europe', x: 532.54, y: 106.9 },
  { id: 'steppewatch', name: "Gaul", continentId: 'europe', x: 512.13, y: 149.67 },
  { id: 'ironridge', name: "Etruria", continentId: 'europe', x: 525.17, y: 168.94 },
  { id: 'blackspire', name: "Rhineland", continentId: 'europe', x: 547.16, y: 137.23 },
  { id: 'grayridge', name: "Pontic Steppe", continentId: 'europe', x: 571.77, y: 143.7 },
  { id: 'cragmoor', name: "Illyria", continentId: 'europe', x: 555.37, y: 169.09 },

  // Africa (7)
  { id: 'duneshore', name: "Maghreb", continentId: 'africa', x: 500, y: 208.06 },
  { id: 'emberwaste', name: "Nile Delta", continentId: 'africa', x: 580.99, y: 221.4 },
  { id: 'sandfall', name: "Sahel", continentId: 'africa', x: 541.61, y: 257.16 },
  { id: 'scorchpeak', name: "Abyssinia", continentId: 'africa', x: 620.43, y: 280.11 },
  { id: 'oasis_vale', name: "Congo Basin", continentId: 'africa', x: 561.84, y: 312.46 },
  { id: 'redrock', name: "Serengeti", continentId: 'africa', x: 601.17, y: 315.7 },
  { id: 'sunspire', name: "Kalahari", continentId: 'africa', x: 564.46, y: 397.16 },

  // Asia (9)
  { id: 'port_meridian', name: "Ob Basin", continentId: 'asia', x: 632.55, y: 114.21 },
  { id: 'sunset_bay', name: "Chukchi Coast", continentId: 'asia', x: 782.05, y: 113.87 },
  { id: 'goldshore', name: "Levant", continentId: 'asia', x: 619.8, y: 208.66 },
  { id: 'ashport', name: "Turkestan", continentId: 'asia', x: 664.93, y: 151.5 },
  { id: 'ridgeway', name: "Deccan", continentId: 'asia', x: 713.05, y: 235.65 },
  { id: 'stonebridge', name: "Cathay", continentId: 'asia', x: 773.83, y: 195.35 },
  { id: 'lakehaven', name: "Mekong Delta", continentId: 'asia', x: 785.73, y: 258.86 },
  { id: 'riverrun', name: "Nippon", continentId: 'asia', x: 848.79, y: 191.44 },
  { id: 'highmarch', name: "Nusantara", continentId: 'asia', x: 817.65, y: 312.37 },

  // Oceania (6)
  { id: 'pearl_isle', name: "Nullarbor", continentId: 'oceania', x: 830.84, y: 384.05 },
  { id: 'reefhaven', name: "Arnhem Land", continentId: 'oceania', x: 869.87, y: 349.25 },
  { id: 'tideport', name: "Coral Coast", continentId: 'oceania', x: 898.63, y: 382.5 },
  { id: 'saltmere', name: "Great Bight", continentId: 'oceania', x: 860.59, y: 414.35 },
  { id: 'driftcay', name: "Bismarck Isles", continentId: 'oceania', x: 901.28, y: 324.48 },
  { id: 'stormatoll', name: "Aotearoa", continentId: 'oceania', x: 936.32, y: 429.54 },
];

// Undirected adjacency edges -- within-continent links follow real
// geographic proximity of the territories above; inter-continent links
// follow the actual bottleneck straits/isthmuses they sit on (Bering
// Strait, Panama, Greenland-Iceland, Gibraltar, the Urals, Suez, the
// Indonesian archipelago).
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

export function areAdjacent(a: string, b: string): boolean {
  return ADJACENCY[a]?.includes(b) ?? false;
}

export function territoriesInContinent(continentId: string): TerritoryDef[] {
  return TERRITORIES.filter((t) => t.continentId === continentId);
}

export const STARTING_ARMIES_BY_PLAYER_COUNT: Record<number, number> = {
  2: 40,
  3: 35,
  4: 30,
  5: 25,
  6: 20,
};

// Territory cards -- generic military-unit symbols (infantry/cavalry/
// artillery), not Risk-specific terminology or art. One card per
// territory plus two wildcards, symbols assigned round-robin so all 42
// territories split evenly (14 each) across the three symbols.
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
