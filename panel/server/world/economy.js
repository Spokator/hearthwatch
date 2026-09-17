// Économie de Spokaheim : boutiques des habitants, stocks, prix dynamiques, caisses, production.
//
// Acheter : le joueur dépose des pièces dans le coffre de remise du marchand et demande (à voix ou « !acheter »).
// Vendre : il dépose ses marchandises et dit « je vends » (ou « !vendre ») ; le marchand paie ce qu'il accepte.
// Les stocks se reconstituent chaque jour de jeu, plus vite quand les joueurs livrent les matières premières
// (contrats) : l'activité des joueurs fait vivre la production de la ville.
import { clamp } from './util.js';

// Prix de base (pièces) des marchandises vendues ou achetées par les habitants.
export const BASE_PRICES = {
  // Boissons et plats
  MeadTasty: 30, MeadHealthMinor: 45, MeadStaminaMinor: 45, MeadPoisonResist: 60, MeadFrostResist: 60, MeadEitrMinor: 70,
  Bread: 28, LoxPie: 50, FishWraps: 32, CookedMeat: 9, CookedDeerMeat: 11, BoarJerky: 18, Sausages: 22, QueensJam: 20,
  CarrotSoup: 16, TurnipStew: 24, FishAndBread: 34, HoneyGlazedChicken: 55, Carrot: 5, Onion: 6, Honey: 8, Raspberry: 2,
  Blueberries: 2, Cloudberry: 4, Mushroom: 3, MushroomYellow: 8, MushroomBlue: 10, Thistle: 5, Dandelion: 3,
  // Viandes et prises
  RawMeat: 5, DeerMeat: 6, NeckTail: 4, Entrails: 3, WolfMeat: 9, LoxMeat: 14, Fish1: 6, Fish2: 9, Fish3: 12, Fish5: 14,
  // Matériaux
  Wood: 1, FineWood: 3, RoundLog: 4, ElderBark: 6, YggdrasilWood: 10, Blackwood: 12, Stone: 1, Flint: 2, Resin: 2,
  LeatherScraps: 3, DeerHide: 7, TrollHide: 20, WolfPelt: 18, LoxPelt: 26, Feathers: 3, Coal: 3, GreydwarfEye: 4,
  Guck: 9, Crystal: 16, Eitr: 22, Ooze: 6, Bloodbag: 6, LinenThread: 18, Chitin: 12, SerpentScale: 20, Obsidian: 5,
  FreezeGland: 10, Needle: 8, Carapace: 18, ScaleHide: 20, Mandible: 20, Sap: 8, Tar: 7, BoneFragments: 2, HardAntler: 12,
  SurtlingCore: 25, CharredBone: 6, AskHide: 22, MorgenSinew: 30, Barley: 5, Flax: 5,
  // Métaux
  CopperOre: 7, TinOre: 6, Copper: 16, Tin: 14, Bronze: 32, IronScrap: 9, Iron: 38, SilverOre: 14, Silver: 45,
  BlackMetalScrap: 16, BlackMetal: 60, FlametalOreNew: 24, FlametalNew: 80,
  // Précieux
  Amber: 25, AmberPearl: 45, Ruby: 70, SilverNecklace: 110,
  // Munitions
  ArrowWood: 1, ArrowFlint: 2, ArrowBronze: 4, ArrowIron: 6,
};

// Boutiques : ce qu'elles vendent (stock visé) et ce qu'elles achètent. `feeds` : livraisons qui relancent la production.
export const SHOPS = {
  tavern: {
    sells: { MeadTasty: 12, MeadHealthMinor: 6, MeadStaminaMinor: 6, FishAndBread: 6, QueensJam: 8, Sausages: 8 },
    buys: ['Honey', 'Raspberry', 'Blueberries', 'Cloudberry', 'Barley', 'Mushroom', 'Fish1', 'Fish2'],
    feeds: { Honey: ['MeadTasty', 'MeadHealthMinor'], Raspberry: ['QueensJam'], Blueberries: ['QueensJam', 'MeadStaminaMinor'], Barley: ['MeadTasty'], Fish1: ['FishAndBread'], Fish2: ['FishAndBread'] },
  },
  kitchen: {
    sells: { CookedMeat: 20, CookedDeerMeat: 12, BoarJerky: 10, Sausages: 10, CarrotSoup: 8, TurnipStew: 6 },
    buys: ['RawMeat', 'DeerMeat', 'NeckTail', 'Entrails', 'Carrot', 'Turnip', 'Onion', 'WolfMeat', 'LoxMeat'],
    feeds: { RawMeat: ['CookedMeat', 'BoarJerky'], DeerMeat: ['CookedDeerMeat'], Entrails: ['Sausages'], Carrot: ['CarrotSoup'], Turnip: ['TurnipStew'] },
  },
  bakery: {
    sells: { Bread: 10, LoxPie: 4, FishWraps: 6, Carrot: 20, Onion: 12 },
    buys: ['Barley', 'Carrot', 'Onion', 'Honey', 'LoxMeat', 'Fish1'],
    feeds: { Barley: ['Bread'], LoxMeat: ['LoxPie'], Fish1: ['FishWraps'], Carrot: ['Carrot'] },
  },
  market: {
    sells: { ArrowWood: 100, ArrowFlint: 80, ArrowBronze: 50, ArrowIron: 40, Resin: 40, LeatherScraps: 30, DeerHide: 15, Feathers: 40, LinenThread: 8 },
    buys: ['*'],
    feeds: { Flint: ['ArrowFlint'], Bronze: ['ArrowBronze'], Iron: ['ArrowIron'], Feathers: ['ArrowWood', 'ArrowFlint'] },
  },
  foundry: {
    sells: { Coal: 60, Copper: 20, Tin: 20, Bronze: 12, Iron: 10 },
    buys: ['CopperOre', 'TinOre', 'IronScrap', 'SilverOre', 'BlackMetalScrap', 'FlametalOreNew', 'Coal', 'Wood'],
    feeds: { CopperOre: ['Copper', 'Bronze'], TinOre: ['Tin', 'Bronze'], IronScrap: ['Iron'], Wood: ['Coal'] },
  },
  mage: {
    sells: { MeadEitrMinor: 5, Tar: 10, Crystal: 6 },
    buys: ['GreydwarfEye', 'Resin', 'Guck', 'Crystal', 'Eitr', 'Ooze', 'Sap', 'SurtlingCore', 'Mandible'],
    feeds: { Sap: ['MeadEitrMinor'], Eitr: ['MeadEitrMinor'] },
  },
  herbs: {
    sells: { MeadHealthMinor: 10, MeadPoisonResist: 6, MeadFrostResist: 6, Thistle: 20, Dandelion: 30 },
    buys: ['Thistle', 'Dandelion', 'Mushroom', 'MushroomYellow', 'MushroomBlue', 'Honey', 'Bloodbag', 'FreezeGland'],
    feeds: { Thistle: ['MeadPoisonResist'], Bloodbag: ['MeadHealthMinor'], FreezeGland: ['MeadFrostResist'], Dandelion: ['MeadHealthMinor'] },
  },
};

export function newEconomy() {
  const shops = {};
  for (const [key, shop] of Object.entries(SHOPS)) {
    shops[key] = { gold: 600, stock: Object.fromEntries(Object.entries(shop.sells).map(([item, target]) => [item, Math.round(target * 0.6)])), supply: {}, sold: 0, bought: 0 };
  }
  return { shops, lastDay: null, history: [] };
}

// Prix de vente au joueur : plus cher quand le stock est bas ; l'humeur et l'amitié du marchand jouent (±15 %).
export function sellPrice(economy, shopKey, item, { valence = 0, affinity = 0, market = 1 } = {}) {
  const shop = SHOPS[shopKey];
  const state = economy.shops[shopKey];
  const base = BASE_PRICES[item];
  if (!shop || !state || !base || !(item in shop.sells)) return null;
  const target = shop.sells[item];
  const scarcity = clamp(1 - (state.stock[item] || 0) / target, 0, 1);
  const mood = 1 - valence * 0.07 - clamp(affinity, -100, 100) * 0.0008;
  return Math.max(1, Math.round(base * (0.9 + 0.6 * scarcity) * mood * market));
}

// Prix d'achat au joueur : la moitié du prix de base environ, davantage si la boutique en manque, rien si elle est pleine.
export function buyPrice(economy, shopKey, item, { valence = 0, affinity = 0 } = {}) {
  const shop = SHOPS[shopKey];
  const state = economy.shops[shopKey];
  const base = BASE_PRICES[item];
  if (!shop || !state || !base) return null;
  const wanted = shop.buys.includes('*') || shop.buys.includes(item);
  if (!wanted) return null;
  const supply = state.supply[item] || 0;
  const saturation = clamp(supply / 60, 0, 1);
  const factor = (shop.buys.includes('*') && !shop.buys.includes(item) ? 0.35 : 0.55) * (1 - 0.5 * saturation);
  const mood = 1 + valence * 0.05 + clamp(affinity, -100, 100) * 0.0006;
  return Math.max(0, Math.floor(base * factor * mood));
}

// Nouveau jour de jeu : production (les livraisons nourrissent les recettes), consommation de la ville, caisses.
export function economyDay(economy) {
  for (const [key, shop] of Object.entries(SHOPS)) {
    const state = economy.shops[key];
    for (const [item, target] of Object.entries(shop.sells)) {
      // Production de base lente, accélérée par les matières livrées.
      let produced = target * 0.12;
      for (const [input, outputs] of Object.entries(shop.feeds || {})) {
        if (!outputs.includes(item) || !(state.supply[input] > 0)) continue;
        const used = Math.min(state.supply[input], target * 0.5);
        state.supply[input] -= used;
        produced += used * 0.6;
      }
      // La ville consomme aussi.
      const consumed = target * 0.08;
      state.stock[item] = clamp((state.stock[item] || 0) + produced - consumed, 0, target * 1.5);
    }
    for (const input of Object.keys(state.supply)) state.supply[input] = Math.max(0, state.supply[input] * 0.85 - 1);
    state.gold = clamp(state.gold + 60, 0, 5000); // recettes des habitants
  }
}

// Ce que la boutique manque le plus : sert aux contrats de livraison générés.
export function shortages(economy, shopKey) {
  const shop = SHOPS[shopKey];
  const state = economy.shops[shopKey];
  if (!shop || !state) return [];
  const out = [];
  for (const [input, outputs] of Object.entries(shop.feeds || {})) {
    const need = outputs.reduce((sum, item) => sum + clamp(1 - (state.stock[item] || 0) / shop.sells[item], 0, 1), 0) / outputs.length;
    out.push({ item: input, need });
  }
  return out.sort((a, b) => b.need - a.need);
}
