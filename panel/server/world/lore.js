// Bible du monde : ce que tout habitant de Spokaheim sait, factions, titres. Sert aux prompts et aux textes du jeu.

export const WORLD_BIBLE = {
  fr: `Spokaheim est la capitale fortifiée de l'Empereur Spoka, bâtie au dixième monde, Valheim, autour des Pierres sacrées où les corbeaux d'Odin déposent les Élus : des guerriers morts au combat, renvoyés pour abattre les Réprouvés, sept créatures maudites (Eikthyr le cerf de foudre, l'Ancien de la Forêt noire, Masse-d'Os des marais, Moder la dragonne des montagnes, Yagluth roi des Fulings des plaines, la Reine des Brumes, Fader des Terres cendrées).
La plupart des habitants sont des Dvergr, des nains exilés des Brumes quand la Reine a asservi leurs frères ; l'Empereur leur a offert refuge en échange de leur savoir-faire. Des marchands itinérants (Haldor, Hildir, la sorcière des marais) tiennent le marché couvert.
L'Empereur se montre rarement ; la chancelière Ingrid Varsdóttir parle en son nom depuis le château. Lieux : grand-place et monument, château impérial, Grande Brasserie, église des Ases, armurerie-musée, marché couvert, fonderie, forge, atelier des bâtisseurs, cuisines, cercle des mages, place des portails, arène, remparts et douves.
Coutumes : sermon à l'aube les jours sacrés, jour du marché, fête de l'hydromel, gloire de l'arène, serments. Monnaie : pièces d'or. On tutoie volontiers, on respecte la parole donnée, on se méfie des voleurs et des lâches.`,
  en: `Spokaheim is the fortified capital of Emperor Spoka, built in the tenth world, Valheim, around the Sacred Stones where Odin's ravens drop the Chosen: warriors fallen in battle, sent back to slay the Forsaken, seven cursed creatures (Eikthyr the thunder stag, the Elder of the Black Forest, Bonemass of the swamps, Moder the mountain dragon, Yagluth king of the Plains Fulings, the Queen of the Mistlands, Fader of the Ashlands).
Most inhabitants are Dvergr, dwarves exiled from the Mistlands when the Queen enslaved their kin; the Emperor gave them refuge in exchange for their craft. Travelling traders (Haldor, Hildir, the Bog Witch) keep the covered market.
The Emperor rarely shows himself; Chancellor Ingrid Varsdóttir speaks for him from the castle. Places: main square and monument, imperial castle, Great Mead Hall, church of the Aesir, armory museum, covered market, foundry, forge, builders' workshop, kitchens, mages' circle, portal square, arena, ramparts and moat.
Customs: dawn sermon on holy days, market day, mead festival, arena glory, oaths. Currency: gold coins. People speak plainly, keep their word, distrust thieves and cowards.`,
};

export const FACTIONS = {
  couronne: { fr: 'la Couronne', en: 'the Crown' },
  garde: { fr: 'la Garde impériale', en: 'the Imperial Guard' },
  artisans: { fr: 'la Guilde des artisans', en: 'the Crafters Guild' },
  marchands: { fr: 'la Maison des marchands', en: 'the Merchants House' },
  temple: { fr: 'le Temple des Ases', en: 'the Temple of the Aesir' },
  peuple: { fr: 'le peuple de Spokaheim', en: 'the people of Spokaheim' },
};

// Renommée totale → titre.
export const TITLES = [
  { min: 0, fr: 'Étranger', en: 'Stranger' },
  { min: 40, fr: 'Voyageur', en: 'Traveller' },
  { min: 150, fr: 'Habitant', en: 'Resident' },
  { min: 400, fr: 'Citoyen de Spokaheim', en: 'Citizen of Spokaheim' },
  { min: 900, fr: 'Héros de Spokaheim', en: 'Hero of Spokaheim' },
  { min: 2000, fr: "Champion de l'Empereur", en: "Emperor's Champion" },
];

// Lieux de la cité, pour le portail et les résumés.
export const PLACE_LABELS = {
  arena: { fr: "l'arène", en: 'the arena' },
  armory: { fr: "l'armurerie-musée", en: 'the armory museum' },
  'brasserie-bar': { fr: 'le bar de la Grande Brasserie', en: 'the mead hall bar' },
  'brasserie-brewery': { fr: 'la distillerie', en: 'the brewery' },
  'brasserie-stage': { fr: 'la scène de la brasserie', en: 'the mead hall stage' },
  castle: { fr: 'le château impérial', en: 'the imperial castle' },
  'castle-salon': { fr: 'le grand salon du château', en: 'the castle great hall' },
  church: { fr: 'église des Ases', en: 'the church of the Aesir' },
  'church-door': { fr: "le parvis de l'église", en: 'the church steps' },
  forge: { fr: 'la forge', en: 'the forge' },
  foundry: { fr: 'la fonderie', en: 'the foundry' },
  'foundry-store': { fr: "l'entrepôt de la fonderie", en: 'the foundry warehouse' },
  garden: { fr: 'les jardins', en: 'the gardens' },
  gate0: { fr: 'la porte est', en: 'the east gate' },
  gate180: { fr: 'la porte ouest', en: 'the west gate' },
  gate270: { fr: 'la porte nord', en: 'the north gate' },
  kitchen: { fr: 'les cuisines', en: 'the kitchens' },
  mage: { fr: 'le cercle des mages', en: "the mages' circle" },
  market: { fr: 'le marché couvert', en: 'the covered market' },
  'market-food': { fr: 'les étals du marché', en: 'the market stalls' },
  plaza: { fr: 'la grand-place', en: 'the main square' },
  'plaza-crier': { fr: 'la tribune du crieur', en: "the crier's stand" },
  portals: { fr: 'la place des portails', en: 'the portal square' },
  workshop: { fr: "l'atelier des bâtisseurs", en: "the builders' workshop" },
  tavern: { fr: 'la Grande Brasserie', en: 'the Great Mead Hall' },
  walls: { fr: 'les remparts', en: 'the ramparts' },
};

export function placeLabel(place, lang = 'fr') {
  const entry = PLACE_LABELS[place];
  return entry ? entry[lang] || entry.fr : place || '';
}

// Renommée qu'il reste à gagner avant le titre suivant.
export function nextTitle(renown, lang = 'fr') {
  const next = TITLES.find((t) => t.min > renown);
  return next ? { at: next.min, label: next[lang] || next.fr, missing: next.min - renown } : null;
}

export function titleFor(renown, lang = 'fr') {
  let current = TITLES[0];
  for (const t of TITLES) if (renown >= t.min) current = t;
  return current[lang] || current.fr;
}

// Affinité d'un habitant envers un joueur → mots pour le prompt et l'interface.
export function affinityWords(value, lang = 'fr') {
  const table = [
    [-60, { fr: 'hostile, le méprise', en: 'hostile, despises them' }],
    [-25, { fr: 'méfiant, ne l’apprécie pas', en: 'wary, dislikes them' }],
    [-5, { fr: 'réservé', en: 'reserved' }],
    [15, { fr: 'neutre, poli', en: 'neutral, polite' }],
    [40, { fr: 'amical', en: 'friendly' }],
    [70, { fr: 'chaleureux, lui fait confiance', en: 'warm, trusts them' }],
    [101, { fr: 'ami proche, loyal', en: 'close friend, loyal' }],
  ];
  for (const [max, words] of table) if (value < max) return words[lang] || words.fr;
  return table[table.length - 1][1][lang];
}

// Boss vaincus (clés de progression du monde) → ce que la ville sait de l'avancée des Élus.
export const BOSS_KEYS = [
  { key: 'defeated_eikthyr', tier: 1, fr: 'Eikthyr', en: 'Eikthyr', prefab: 'Eikthyr' },
  { key: 'defeated_gdking', tier: 2, fr: "l'Ancien", en: 'the Elder', prefab: 'gd_king' },
  { key: 'defeated_bonemass', tier: 3, fr: 'Masse-d’Os', en: 'Bonemass', prefab: 'Bonemass' },
  { key: 'defeated_dragon', tier: 4, fr: 'Moder', en: 'Moder', prefab: 'Dragon' },
  { key: 'defeated_goblinking', tier: 5, fr: 'Yagluth', en: 'Yagluth', prefab: 'GoblinKing' },
  { key: 'defeated_queen', tier: 6, fr: 'la Reine', en: 'the Queen', prefab: 'SeekerQueen' },
  { key: 'defeated_fader', tier: 7, fr: 'Fader', en: 'Fader', prefab: 'Fader' },
];

export function worldTier(keys = []) {
  let tier = 0;
  for (const boss of BOSS_KEYS) if (keys.some((k) => k.toLowerCase() === boss.key)) tier = Math.max(tier, boss.tier);
  return tier;
}
