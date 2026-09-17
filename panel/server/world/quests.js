// Quêtes : contrats du quotidien proposés par les habitants, et saga principale.
//
// Objectifs vérifiés par le serveur, sans rien installer côté joueur :
//   deliver (objets déposés dans le coffre de remise du donneur), kill (créatures tuées, attribuées au dernier joueur
//   qui les a frappées ; les boss comptent pour tous les joueurs proches), visit (être dans un biome), arena (gagner un
//   combat d'arène), talk (parler à un habitant).
import { pick } from './util.js';

// Coffre de remise de chaque habitant (clé du coffre dans la ville).
export const COUNTERS = {
  ingrid: 'castle', hilda: 'castle', hrolf: 'castle', arne: 'castle', bjorn: 'forge', kari: 'forge', eirik: 'forge',
  astrid: 'kitchen', yrsa: 'kitchen', brynja: 'kitchen', gunnhild: 'foundry', orm: 'foundry', halla: 'workshop',
  vigdis: 'mage', solveig: 'brasserie', gorm: 'brasserie', leif: 'brasserie', dagny: 'church', hakon: 'church',
  sten: 'church', egil: 'armory', ragna: 'arena', thyra: 'portals', ragnhild: 'market', bodil: 'market',
  frida: 'market', olaf: 'market', ivar: 'market', sigrun: 'castle', torvald: 'castle', ulfar: 'castle',
};

const D = (t0, t1, title, items, coins, extra = {}) => ({ tiers: [t0, t1], kind: 'deliver', title, items, coins, ...extra });
const K = (t0, t1, title, targets, count, coins, extra = {}) => ({ tiers: [t0, t1], kind: 'kill', title, targets, count, coins, ...extra });
const V = (t0, t1, title, biome, coins) => ({ tiers: [t0, t1], kind: 'visit', title, biome, coins });

// Contrats par profil de donneur. Les titres sont affichés dans le journal et repris par l'IA.
export const CONTRACTS = {
  forge: [
    D(0, 1, 'Du silex et du bois pour la forge', [['Flint', 15], ['Wood', 30]], 30),
    D(1, 2, 'Minerai pour le bronze', [['CopperOre', 15], ['TinOre', 8]], 70),
    D(2, 4, 'La ferraille des marais', [['IronScrap', 20]], 100),
    D(3, 5, "L'argent des montagnes", [['SilverOre', 15]], 140),
    D(4, 7, 'Le métal noir des plaines', [['BlackMetalScrap', 20]], 180),
    D(6, 7, 'Le flamétal des Terres cendrées', [['FlametalOreNew', 15]], 260),
  ],
  foundry: [
    D(0, 7, 'Du bois pour les charbonnières', [['Wood', 50]], 30),
    D(1, 3, 'Minerai de cuivre pour les fours', [['CopperOre', 20]], 70),
    D(1, 3, "Minerai d'étain", [['TinOre', 12]], 55),
    D(2, 5, 'Ferraille pour la fonte', [['IronScrap', 25]], 110),
    D(3, 6, "Minerai d'argent", [['SilverOre', 20]], 150),
    D(4, 7, 'Ferraille de métal noir', [['BlackMetalScrap', 25]], 190),
  ],
  kitchen: [
    D(0, 2, 'De la viande pour les cuisines', [['RawMeat', 10]], 30),
    D(0, 2, 'Du gibier pour le château', [['DeerMeat', 10]], 35),
    D(1, 4, 'Des carottes pour la soupe', [['Carrot', 15]], 45),
    D(2, 5, 'Des navets pour le ragoût', [['Turnip', 12]], 55),
    D(3, 6, 'Viande de loup', [['WolfMeat', 8]], 65),
    D(4, 7, 'Viande de lox pour les tourtes', [['LoxMeat', 8]], 85),
  ],
  bounty: [
    K(0, 1, 'Les Greylings rôdent', ['Greyling'], 8, 30),
    K(1, 2, 'Prime : Greydwarfs', ['Greydwarf', 'Greydwarf_Elite', 'Greydwarf_Shaman'], 10, 50),
    K(1, 3, 'Prime : un troll', ['Troll'], 1, 100),
    K(1, 3, 'Les os des cryptes', ['Skeleton', 'Skeleton_Poison'], 8, 55),
    K(2, 4, 'Prime : draugrs', ['Draugr', 'Draugr_Elite', 'Draugr_Ranged'], 10, 85),
    K(2, 4, 'Nettoyer les marais', ['Blob', 'BlobElite', 'Leech'], 8, 75),
    K(3, 5, 'Les loups des montagnes', ['Wolf'], 8, 95),
    K(3, 5, 'Prime : fenrings', ['Fenring', 'Fenring_Cultist'], 2, 130),
    K(4, 6, 'Prime : fulings', ['Goblin', 'GoblinBrute', 'GoblinShaman', 'GoblinArcher'], 12, 140),
    K(4, 6, 'Les moustiques de la mort', ['Deathsquito'], 5, 115),
    K(5, 7, 'Prime : chercheurs des Brumes', ['Seeker', 'SeekerBrute', 'SeekerBrood'], 6, 180),
    K(6, 7, 'Prime : les Carbonisés', ['Charred_Melee', 'Charred_Archer', 'Charred_Mage'], 10, 230),
  ],
  hunt: [
    K(0, 2, 'Chasse au cerf', ['Deer'], 6, 30),
    K(0, 2, 'Chasse au sanglier', ['Boar'], 8, 30),
    D(0, 2, 'Des trophées de cerf', [['TrophyDeer', 3]], 35),
    K(3, 5, 'Réguler les loups', ['Wolf'], 6, 85),
    K(4, 6, 'Chasse au lox', ['Lox'], 3, 120),
    K(6, 7, 'Chasse aux asksvins', ['Asksvin'], 5, 190),
  ],
  farm: [
    K(0, 7, 'Les sangliers ravagent les navets', ['Boar'], 6, 30),
    K(0, 7, 'Les necks dans les rigoles', ['Neck'], 5, 28),
    D(1, 7, 'Des graines de carotte', [['CarrotSeeds', 10]], 40),
  ],
  fish: [
    D(0, 3, 'Des perches pour la ville', [['Fish1', 5]], 35),
    D(1, 4, 'Des brochets', [['Fish2', 4]], 45),
    D(2, 5, 'Du thon', [['Fish3', 3]], 60),
    K(2, 7, 'Le serpent de mer', ['Serpent'], 1, 260),
  ],
  brewery: [
    D(0, 7, 'Du miel pour l’hydromel', [['Honey', 10]], 50),
    D(0, 3, 'Des framboises pour la confiture', [['Raspberry', 30]], 30),
    D(1, 4, 'Des myrtilles pour une recette', [['Blueberries', 30]], 35),
    D(3, 6, 'Des plaquebières', [['Cloudberry', 20]], 50),
    D(2, 6, 'Des champignons jaunes (pour une expérience)', [['MushroomYellow', 8]], 55),
  ],
  temple: [
    D(0, 7, 'Offrande de pissenlits', [['Dandelion', 12]], 30),
    D(1, 7, 'Offrande de chardons bleus', [['Thistle', 10]], 40),
    D(1, 3, 'Trophées de greydwarfs pour la purification', [['TrophyGreydwarf', 5]], 50),
    D(1, 4, 'Crânes pour le rite des morts', [['TrophySkeleton', 3]], 55),
    D(2, 5, 'Trophées de draugrs pour apaiser les marais', [['TrophyDraugr', 3]], 75),
  ],
  mage: [
    D(0, 2, 'De la résine pour les runes', [['Resin', 30]], 30),
    D(1, 3, 'Des yeux de greydwarf', [['GreydwarfEye', 20]], 40),
    D(1, 4, 'Des cœurs de surtling', [['SurtlingCore', 5]], 85),
    D(2, 4, 'De la vase des marais', [['Guck', 10]], 65),
    D(3, 5, 'Des cristaux des montagnes', [['Crystal', 10]], 95),
    D(5, 7, 'De l’Eitr raffiné', [['Eitr', 12]], 150),
  ],
  workshop: [
    D(0, 7, 'Du bois pour les chantiers', [['Wood', 60]], 35),
    D(1, 7, 'Du bois fin pour les charpentes', [['FineWood', 30]], 55),
    D(1, 7, 'Du bois de cœur pour la poutre du château', [['RoundLog', 25]], 65),
    D(2, 7, 'De l’écorce ancienne', [['ElderBark', 20]], 75),
    D(5, 7, 'Du bois d’Yggdrasil', [['YggdrasilWood', 25]], 120),
    D(6, 7, 'Du bois noir', [['Blackwood', 20]], 140),
  ],
  armory: [
    D(0, 2, 'Un trophée de sanglier pour le musée', [['TrophyBoar', 2]], 35),
    D(0, 2, 'Un trophée de neck pour le musée', [['TrophyNeck', 2]], 35),
    D(1, 3, 'Trophée de greydwarf brute', [['TrophyGreydwarfBrute', 2]], 65),
    D(1, 4, 'Trophée de troll', [['TrophyForestTroll', 1]], 110),
    D(2, 4, 'Trophée de blob', [['TrophyBlob', 2]], 75),
    D(3, 5, 'Trophée de loup', [['TrophyWolf', 2]], 85),
    D(3, 5, 'Trophée de fenring', [['TrophyFenring', 1]], 130),
    D(4, 6, 'Trophée de fuling brute', [['TrophyGoblinBrute', 1]], 160),
    D(5, 7, 'Trophée de chercheur brute', [['TrophySeekerBrute', 1]], 210),
    D(6, 7, 'Trophée de morgen', [['TrophyMorgen', 1]], 320),
  ],
  arena: [{ tiers: [0, 7], kind: 'arena', title: 'Gagner un combat dans l’arène', count: 1, coins: 90 }],
  explore: [
    V(0, 2, 'Rapporter des nouvelles de la Forêt noire', 'BlackForest', 45),
    V(1, 3, 'Explorer les marais', 'Swamp', 65),
    V(1, 7, "Naviguer jusqu'à l'océan", 'Ocean', 70),
    V(2, 4, 'Gravir les montagnes', 'Mountain', 85),
    V(3, 5, 'Traverser les plaines', 'Plains', 105),
    V(4, 6, 'Entrer dans les Brumes', 'Mistlands', 140),
    V(5, 7, 'Fouler les Terres cendrées', 'AshLands', 180),
    V(6, 7, 'Atteindre le Nord profond', 'DeepNorth', 210),
  ],
  merchant: [
    D(0, 2, 'Des chutes de cuir', [['LeatherScraps', 30]], 40),
    D(0, 3, 'Des peaux de cerf', [['DeerHide', 15]], 55),
    D(0, 7, 'De l’ambre', [['Amber', 3]], 95),
    D(1, 7, 'Des perles d’ambre', [['AmberPearl', 2]], 115),
    D(1, 4, 'Des peaux de troll', [['TrollHide', 8]], 95),
    D(2, 7, 'Des rubis', [['Ruby', 2]], 160),
    D(3, 6, 'Des peaux de loup', [['WolfPelt', 10]], 115),
  ],
  baker: [
    D(0, 7, 'Du miel pour les brioches', [['Honey', 8]], 40),
    D(1, 7, 'Des carottes', [['Carrot', 20]], 45),
    D(3, 7, 'Des oignons', [['Onion', 15]], 55),
    D(4, 7, 'De l’orge pour le pain', [['Barley', 30]], 65),
  ],
  herbs: [
    D(0, 7, 'Des pissenlits pour les tisanes', [['Dandelion', 15]], 30),
    D(1, 7, 'Des chardons pour les remèdes', [['Thistle', 12]], 45),
    D(0, 4, 'Des champignons', [['Mushroom', 20]], 35),
    D(2, 6, 'Des champignons jaunes', [['MushroomYellow', 10]], 65),
    D(2, 5, 'Des poches de sang', [['Bloodbag', 10]], 65),
    D(3, 6, 'Des glandes gelées', [['FreezeGland', 8]], 75),
  ],
  couronne: [
    D(2, 7, 'Renforcer les remparts', [['Stone', 80], ['Iron', 10]], 160),
    K(1, 7, 'Protéger les routes de l’Empire', ['Greydwarf', 'Draugr', 'Goblin', 'Seeker', 'Charred_Melee'], 15, 150),
  ],
  intendance: [
    D(0, 7, 'Des chandelles pour le château', [['Resin', 25]], 35),
    D(0, 4, 'Du cuir pour les harnais', [['LeatherScraps', 25]], 35),
    D(4, 7, 'Du fil de lin pour les tentures', [['LinenThread', 10]], 95),
  ],
  tavern: [
    D(0, 7, 'La tournée générale', [['Honey', 8]], 40),
    K(0, 7, 'Les nuisibles du cellier', ['Neck', 'Greyling', 'Leech'], 6, 35),
  ],
  vagrant: [
    D(0, 7, 'Un hydromel pour un vieil homme', [['MeadTasty', 1]], 15, { rumor: true }),
    D(0, 7, 'Du pain pour Sten', [['Bread', 2]], 20, { rumor: true }),
  ],
};

// Échelle des récompenses selon la progression du monde.
const tierScale = (tier) => 1 + tier * 0.12;

// Offres du jour d'un habitant : jusqu'à deux contrats adaptés à la progression, en préférant ce qui manque à la ville.
export function dailyOffers(npc, { tier, day, random, shortages = [], valid = () => true }) {
  const list = CONTRACTS[npc.contracts] || [];
  const usable = list.filter((c) => tier >= c.tiers[0] && tier <= c.tiers[1] + 1 && c.tiers[0] <= tier + 0).filter((c) => valid(c));
  const fallback = list.filter((c) => c.tiers[0] <= tier && valid(c));
  const pool = usable.length ? usable : fallback;
  if (!pool.length) return [];
  const wanted = new Set(shortages.filter((s) => s.need > 0.4).map((s) => s.item));
  const ranked = [...pool].sort((a, b) => (hits(b, wanted) - hits(a, wanted)) || random() - 0.5);
  const count = Math.min(2, ranked.length);
  return ranked.slice(0, count).map((c, i) => ({
    id: `${npc.key}-${day}-${i}`,
    giver: npc.key,
    kind: c.kind,
    title: c.title,
    items: c.items,
    targets: c.targets,
    count: c.count,
    biome: c.biome,
    rumor: !!c.rumor,
    coins: Math.round((c.coins * tierScale(tier)) / 5) * 5,
    faction: npc.faction,
    day,
  }));
}

const hits = (contract, wanted) => (contract.items || []).filter(([item]) => wanted.has(item)).length;

export function objectivesOf(offer) {
  if (offer.kind === 'deliver') return offer.items.map(([item, count]) => ({ type: 'deliver', item, count, progress: 0 }));
  if (offer.kind === 'kill') return [{ type: 'kill', targets: offer.targets, count: offer.count, progress: 0 }];
  if (offer.kind === 'visit') return [{ type: 'visit', biome: offer.biome, count: 1, progress: 0 }];
  if (offer.kind === 'arena') return [{ type: 'arena', count: offer.count || 1, progress: 0 }];
  return [];
}

// ---------- Saga principale ----------
// Étapes : talk (parler à un habitant), deliver, kill, visit, flag (événement du monde). `after` : chapitre requis.

export const SAGA = [
  {
    id: 'prologue',
    title: "L'arrivée de l'Élu",
    steps: [
      { type: 'talk', npc: 'sigrun', text: 'Se présenter à la garde de la porte Sud' },
      { type: 'talk', npc: 'ingrid', text: 'Obtenir une audience auprès de la chancelière au château' },
      { type: 'kill', targets: ['Boar', 'Neck', 'Greyling'], count: 5, text: 'Prouver sa valeur : abattre 5 bêtes des prairies' },
      { type: 'talk', npc: 'ingrid', text: 'Revenir auprès de la chancelière' },
    ],
    reward: { coins: 60, renown: 40, faction: 'couronne' },
  },
  {
    id: 'eikthyr',
    after: 'prologue',
    title: 'Le Cerf de foudre',
    steps: [
      { type: 'talk', npc: 'dagny', text: 'Écouter la vision de la prêtresse Dagny' },
      { type: 'kill', targets: ['Eikthyr'], count: 1, text: 'Abattre Eikthyr', boss: true },
      { type: 'deliver', npc: 'egil', items: [['TrophyEikthyr', 1]], text: "Offrir le trophée d'Eikthyr à l'armurerie" },
      { type: 'talk', npc: 'ingrid', text: 'Faire son rapport à la chancelière' },
    ],
    reward: { coins: 150, renown: 110, faction: 'couronne' },
  },
  {
    id: 'eirik',
    after: 'eikthyr',
    title: 'Le fils du forgeron',
    steps: [
      { type: 'talk', npc: 'bjorn', text: 'Demander à Bjorn pourquoi il est si sombre' },
      { type: 'talk', npc: 'kari', text: 'Faire parler Kari, qui semble en savoir plus' },
      { type: 'visit', biome: 'BlackForest', text: 'Suivre la piste d’Eirik dans la Forêt noire' },
      { type: 'kill', targets: ['Skeleton', 'Skeleton_Poison', 'Ghost'], count: 6, text: 'Fouiller les cryptes et écarter les morts' },
      { type: 'talk', npc: 'bjorn', text: 'Ramener des nouvelles à Bjorn', flag: 'eirik_returned' },
    ],
    reward: { coins: 180, renown: 120, faction: 'artisans' },
  },
  {
    id: 'elder',
    after: 'eirik',
    title: "La colère de l'Ancien",
    steps: [
      { type: 'talk', npc: 'halla', text: 'Écouter Halla : la poutre du château est fendue' },
      { type: 'deliver', npc: 'halla', items: [['RoundLog', 20]], text: 'Rapporter du bois de cœur' },
      { type: 'kill', targets: ['gd_king'], count: 1, text: "Abattre l'Ancien de la Forêt noire", boss: true },
      { type: 'talk', npc: 'ingrid', text: 'Annoncer la victoire au château' },
    ],
    reward: { coins: 220, renown: 150, faction: 'couronne' },
  },
  {
    id: 'bonemass',
    after: 'elder',
    title: 'La peste des marais',
    steps: [
      { type: 'talk', npc: 'yrsa', text: "Écouter l'herboriste : une fièvre gagne la ville" },
      { type: 'deliver', npc: 'yrsa', items: [['Bloodbag', 10], ['Thistle', 10]], text: 'Rapporter de quoi préparer un remède' },
      { type: 'kill', targets: ['Bonemass'], count: 1, text: 'Abattre Masse-d’Os, source de la peste', boss: true },
      { type: 'talk', npc: 'dagny', text: 'Faire bénir la ville par la prêtresse' },
    ],
    reward: { coins: 280, renown: 190, faction: 'temple' },
  },
  {
    id: 'moder',
    after: 'bonemass',
    title: "L'ombre sur les douves",
    steps: [
      { type: 'talk', npc: 'ulfar', text: 'Écouter ce qu’Ulfar a vu la nuit' },
      { type: 'visit', biome: 'Mountain', text: 'Monter dans les montagnes' },
      { type: 'kill', targets: ['Dragon'], count: 1, text: 'Abattre Moder', boss: true },
      { type: 'talk', npc: 'ingrid', text: 'Faire son rapport ; la chancelière semble cacher quelque chose' },
    ],
    reward: { coins: 340, renown: 240, faction: 'couronne' },
  },
  {
    id: 'yagluth',
    after: 'moder',
    title: 'Le roi des Fulings',
    steps: [
      { type: 'talk', npc: 'hrolf', text: 'Le capitaine prépare une expédition' },
      { type: 'kill', targets: ['Goblin', 'GoblinBrute', 'GoblinShaman', 'GoblinArcher'], count: 20, text: 'Décimer les villages fulings' },
      { type: 'kill', targets: ['GoblinKing'], count: 1, text: 'Abattre Yagluth', boss: true },
      { type: 'talk', npc: 'hrolf', text: 'Revenir auprès du capitaine' },
    ],
    reward: { coins: 420, renown: 300, faction: 'garde' },
  },
  {
    id: 'queen',
    after: 'yagluth',
    title: 'La sœur de Thyra',
    steps: [
      { type: 'talk', npc: 'thyra', text: 'Thyra a vu sa sœur dans les Brumes' },
      { type: 'visit', biome: 'Mistlands', text: 'Entrer dans les Brumes' },
      { type: 'kill', targets: ['SeekerQueen'], count: 1, text: 'Abattre la Reine et libérer les Dvergr asservis', boss: true },
      { type: 'talk', npc: 'thyra', text: 'Annoncer la libération à Thyra' },
    ],
    reward: { coins: 520, renown: 380, faction: 'couronne' },
  },
  {
    id: 'fader',
    after: 'queen',
    title: 'Les cendres de la couronne',
    steps: [
      { type: 'talk', npc: 'vigdis', text: 'Vigdis a lu une prophétie dans les runes' },
      { type: 'talk', npc: 'ingrid', text: 'Apprendre la vérité sur la santé de l’Empereur' },
      { type: 'kill', targets: ['Fader'], count: 1, text: 'Abattre Fader et briser la malédiction', boss: true },
      { type: 'talk', npc: 'ingrid', text: "Recevoir la reconnaissance de l'Empereur", flag: 'emperor_healed' },
    ],
    reward: { coins: 800, renown: 600, faction: 'couronne' },
  },
];

// Une cible « Draugr » compte aussi pour ses variantes (Draugr_sleeping, Draugr_Elite…), sauf les invocations amies.
export function targetMatches(targets, prefab) {
  if (!prefab || /_Friendly|_Summoned/.test(prefab)) return false;
  return targets.some((t) => prefab === t || prefab.startsWith(`${t}_`));
}

export function sagaChapter(id) {
  return SAGA.find((c) => c.id === id);
}

// Prochain chapitre ouvert pour un joueur.
export function nextChapter(done = []) {
  return SAGA.find((c) => !done.includes(c.id) && (!c.after || done.includes(c.after)));
}

export function randomRumorItem(random) {
  return pick(['MeadTasty', 'Bread'], random);
}
