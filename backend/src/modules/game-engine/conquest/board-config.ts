// An original 42-territory world across 6 fictional continents -- not a
// reproduction of Risk's actual map, names, or layout. Territories are
// laid out as a node-link graph (x/y in 0-1 fractional space) rather than
// geographic country shapes, matching the app's house style of simple,
// original, procedurally styled boards (see Tycoon's board-config.ts).

export interface ContinentDef {
  id: string;
  name: string;
}

export interface TerritoryDef {
  id: string;
  name: string;
  continentId: string;
  x: number;
  y: number;
}

export const CONTINENTS: ContinentDef[] = [
  { id: 'frosthold', name: 'Frosthold' },
  { id: 'meridian', name: 'Meridian Coast' },
  { id: 'sunward', name: 'Sunward Reaches' },
  { id: 'emerald', name: 'Emerald Basin' },
  { id: 'ashfall', name: 'Ashfall Steppe' },
  { id: 'coral', name: 'Coral Archipelago' },
];

export const TERRITORIES: TerritoryDef[] = [
  // Frosthold (7)
  { id: 'icemark', name: 'Icemark', continentId: 'frosthold', x: 0.1, y: 0.1 },
  { id: 'glacier_reach', name: 'Glacier Reach', continentId: 'frosthold', x: 0.22, y: 0.07 },
  { id: 'frozen_cape', name: 'Frozen Cape', continentId: 'frosthold', x: 0.34, y: 0.12 },
  { id: 'tundrafall', name: 'Tundrafall', continentId: 'frosthold', x: 0.46, y: 0.08 },
  { id: 'whitepeak', name: 'Whitepeak', continentId: 'frosthold', x: 0.58, y: 0.14 },
  { id: 'snowvale', name: 'Snowvale', continentId: 'frosthold', x: 0.36, y: 0.22 },
  { id: 'coldharbor', name: 'Coldharbor', continentId: 'frosthold', x: 0.2, y: 0.2 },

  // Meridian Coast (9)
  { id: 'port_meridian', name: 'Port Meridian', continentId: 'meridian', x: 0.06, y: 0.3 },
  { id: 'sunset_bay', name: 'Sunset Bay', continentId: 'meridian', x: 0.16, y: 0.27 },
  { id: 'goldshore', name: 'Goldshore', continentId: 'meridian', x: 0.28, y: 0.3 },
  { id: 'ashport', name: 'Ashport', continentId: 'meridian', x: 0.34, y: 0.4 },
  { id: 'ridgeway', name: 'Ridgeway', continentId: 'meridian', x: 0.24, y: 0.44 },
  { id: 'stonebridge', name: 'Stonebridge', continentId: 'meridian', x: 0.12, y: 0.42 },
  { id: 'lakehaven', name: 'Lakehaven', continentId: 'meridian', x: 0.06, y: 0.52 },
  { id: 'riverrun', name: 'Riverrun', continentId: 'meridian', x: 0.18, y: 0.56 },
  { id: 'highmarch', name: 'Highmarch', continentId: 'meridian', x: 0.3, y: 0.54 },

  // Sunward Reaches (7)
  { id: 'duneshore', name: 'Duneshore', continentId: 'sunward', x: 0.42, y: 0.3 },
  { id: 'emberwaste', name: 'Emberwaste', continentId: 'sunward', x: 0.54, y: 0.28 },
  { id: 'sandfall', name: 'Sandfall', continentId: 'sunward', x: 0.66, y: 0.32 },
  { id: 'scorchpeak', name: 'Scorchpeak', continentId: 'sunward', x: 0.7, y: 0.44 },
  { id: 'oasis_vale', name: 'Oasis Vale', continentId: 'sunward', x: 0.58, y: 0.42 },
  { id: 'redrock', name: 'Redrock', continentId: 'sunward', x: 0.46, y: 0.44 },
  { id: 'sunspire', name: 'Sunspire', continentId: 'sunward', x: 0.56, y: 0.54 },

  // Emerald Basin (6)
  { id: 'vineholt', name: 'Vineholt', continentId: 'emerald', x: 0.16, y: 0.66 },
  { id: 'canopy_reach', name: 'Canopy Reach', continentId: 'emerald', x: 0.26, y: 0.64 },
  { id: 'mistwood', name: 'Mistwood', continentId: 'emerald', x: 0.36, y: 0.68 },
  { id: 'serpents_delta', name: "Serpent's Delta", continentId: 'emerald', x: 0.14, y: 0.8 },
  { id: 'junglecrown', name: 'Junglecrown', continentId: 'emerald', x: 0.26, y: 0.82 },
  { id: 'verdant_hollow', name: 'Verdant Hollow', continentId: 'emerald', x: 0.36, y: 0.84 },

  // Ashfall Steppe (7)
  { id: 'cinderpeak', name: 'Cinderpeak', continentId: 'ashfall', x: 0.54, y: 0.6 },
  { id: 'volcarest', name: 'Volcarest', continentId: 'ashfall', x: 0.64, y: 0.58 },
  { id: 'steppewatch', name: 'Steppewatch', continentId: 'ashfall', x: 0.74, y: 0.62 },
  { id: 'ironridge', name: 'Ironridge', continentId: 'ashfall', x: 0.78, y: 0.72 },
  { id: 'blackspire', name: 'Blackspire', continentId: 'ashfall', x: 0.68, y: 0.76 },
  { id: 'grayridge', name: 'Grayridge', continentId: 'ashfall', x: 0.58, y: 0.74 },
  { id: 'cragmoor', name: 'Cragmoor', continentId: 'ashfall', x: 0.66, y: 0.86 },

  // Coral Archipelago (6)
  { id: 'pearl_isle', name: 'Pearl Isle', continentId: 'coral', x: 0.86, y: 0.14 },
  { id: 'reefhaven', name: 'Reefhaven', continentId: 'coral', x: 0.94, y: 0.2 },
  { id: 'tideport', name: 'Tideport', continentId: 'coral', x: 0.9, y: 0.3 },
  { id: 'saltmere', name: 'Saltmere', continentId: 'coral', x: 0.84, y: 0.38 },
  { id: 'driftcay', name: 'Driftcay', continentId: 'coral', x: 0.92, y: 0.44 },
  { id: 'stormatoll', name: 'Stormatoll', continentId: 'coral', x: 0.86, y: 0.52 },
];

// Undirected adjacency edges -- both within each continent (a connected
// mesh, not just a bare ring) and a handful of inter-continent "bottleneck"
// links, same idea as the straits/isthmuses on a real Risk map.
const EDGES: Array<[string, string]> = [
  // Frosthold
  ['icemark', 'glacier_reach'],
  ['glacier_reach', 'frozen_cape'],
  ['frozen_cape', 'tundrafall'],
  ['tundrafall', 'whitepeak'],
  ['icemark', 'coldharbor'],
  ['coldharbor', 'glacier_reach'],
  ['coldharbor', 'snowvale'],
  ['snowvale', 'frozen_cape'],
  ['snowvale', 'whitepeak'],

  // Meridian Coast
  ['port_meridian', 'sunset_bay'],
  ['sunset_bay', 'goldshore'],
  ['goldshore', 'ashport'],
  ['ashport', 'ridgeway'],
  ['ridgeway', 'stonebridge'],
  ['stonebridge', 'port_meridian'],
  ['stonebridge', 'lakehaven'],
  ['lakehaven', 'riverrun'],
  ['riverrun', 'ridgeway'],
  ['riverrun', 'highmarch'],
  ['highmarch', 'ashport'],
  ['port_meridian', 'lakehaven'],

  // Sunward Reaches
  ['duneshore', 'emberwaste'],
  ['emberwaste', 'sandfall'],
  ['sandfall', 'scorchpeak'],
  ['scorchpeak', 'oasis_vale'],
  ['oasis_vale', 'emberwaste'],
  ['oasis_vale', 'redrock'],
  ['redrock', 'duneshore'],
  ['redrock', 'sunspire'],
  ['sunspire', 'oasis_vale'],
  ['sunspire', 'scorchpeak'],

  // Emerald Basin
  ['vineholt', 'canopy_reach'],
  ['canopy_reach', 'mistwood'],
  ['vineholt', 'serpents_delta'],
  ['serpents_delta', 'junglecrown'],
  ['junglecrown', 'canopy_reach'],
  ['junglecrown', 'verdant_hollow'],
  ['verdant_hollow', 'mistwood'],

  // Ashfall Steppe
  ['cinderpeak', 'volcarest'],
  ['volcarest', 'steppewatch'],
  ['steppewatch', 'ironridge'],
  ['ironridge', 'blackspire'],
  ['blackspire', 'volcarest'],
  ['blackspire', 'grayridge'],
  ['grayridge', 'cinderpeak'],
  ['grayridge', 'cragmoor'],
  ['cragmoor', 'blackspire'],

  // Coral Archipelago
  ['pearl_isle', 'reefhaven'],
  ['reefhaven', 'tideport'],
  ['tideport', 'saltmere'],
  ['tideport', 'driftcay'],
  ['driftcay', 'stormatoll'],
  ['stormatoll', 'saltmere'],
  ['saltmere', 'pearl_isle'],

  // Inter-continent bottlenecks
  ['icemark', 'port_meridian'],
  ['coldharbor', 'sunset_bay'],
  ['ashport', 'duneshore'],
  ['highmarch', 'redrock'],
  ['riverrun', 'vineholt'],
  ['sunspire', 'cinderpeak'],
  ['scorchpeak', 'volcarest'],
  ['verdant_hollow', 'cragmoor'],
  ['whitepeak', 'pearl_isle'],
  ['sandfall', 'saltmere'],
  ['steppewatch', 'stormatoll'],
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
