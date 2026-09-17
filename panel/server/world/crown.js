// La Couronne : l'Empereur, son trésor, ses décrets, ses titres et l'humeur de son peuple.
//
// Tout ce qui se décide au château se voit dans la cité : une taxe trop lourde fait gronder les artisans, une
// fête les apaise, un chantier payé par le trésor les rend fiers. Les habitants en parlent d'eux-mêmes, parce
// que l'humeur du peuple est donnée à l'IA comme n'importe quel autre fait du monde.

// Décrets : ce que l'Empereur peut ordonner. `days` est la durée en jours de jeu, `cost` ce que ça prend au trésor.
export const DECREES = [
  {
    id: 'taxe',
    argument: 'rate',
    title: { fr: 'Fixer la taxe impériale', en: 'Set the imperial tax' },
    describe: {
      fr: (d) => `Taxe impériale fixée à ${Math.round((d.rate || 0) * 100)} % sur toute récompense.`,
      en: (d) => `Imperial tax set to ${Math.round((d.rate || 0) * 100)}% on every reward.`,
    },
    days: 0, // permanent, jusqu'au décret suivant
    unrest: (d) => (d.rate - 0.1) * 60, // au-delà de 10 %, le peuple grince
  },
  {
    id: 'fete',
    title: { fr: 'Ordonner une fête', en: 'Order a feast' },
    describe: {
      fr: () => 'L’Empereur offre une fête à la cité : hydromel pour tous à la Grande Brasserie.',
      en: () => 'The Emperor offers the city a feast: mead for all at the Great Mead Hall.',
    },
    days: 1,
    cost: 300,
    unrest: () => -18,
    event: 'fete',
  },
  {
    id: 'alerte',
    title: { fr: 'Décréter l’état d’alerte', en: 'Declare a state of alert' },
    describe: {
      fr: () => 'État d’alerte : la garde double les tours, les primes de chasse sont doublées, les portes se ferment tôt.',
      en: () => 'State of alert: the guard doubles the watch, hunting bounties are doubled, the gates close early.',
    },
    days: 2,
    cost: 200,
    unrest: () => 6,
  },
  {
    id: 'marche',
    title: { fr: 'Subventionner le marché', en: 'Subsidise the market' },
    describe: {
      fr: () => 'Le trésor paie une partie des étals : les prix baissent d’un cinquième.',
      en: () => 'The treasury pays part of the stalls: prices drop by a fifth.',
    },
    days: 2,
    cost: 400,
    unrest: () => -12,
  },
  {
    id: 'amnistie',
    title: { fr: 'Proclamer l’amnistie', en: 'Proclaim an amnesty' },
    describe: {
      fr: () => 'Amnistie impériale : toutes les amendes sont effacées.',
      en: () => 'Imperial amnesty: every fine is wiped clean.',
    },
    days: 0,
    unrest: () => -8,
  },
  {
    id: 'chantier',
    title: { fr: 'Financer le grand chantier', en: 'Fund the great works' },
    describe: {
      fr: () => 'Le trésor impérial paie les matériaux manquants du chantier en cours.',
      en: () => 'The imperial treasury pays for the materials the works still lack.',
    },
    days: 0,
    cost: 600,
    unrest: () => -20,
  },
  {
    id: 'garde',
    title: { fr: 'Payer la solde de la garde', en: 'Pay the guard’s wages' },
    describe: {
      fr: () => 'La solde est versée : la garde veille mieux, les raids sont moins nombreux.',
      en: () => 'Wages are paid: the guard watches better and raids come thinner.',
    },
    days: 4,
    cost: 350,
    unrest: () => -10,
  },
];

// Titres accordés par l'Empereur. Ils ne s'achètent pas : ils se donnent.
export const HONOURS = [
  {
    id: 'chevalier',
    title: { fr: 'Chevalier de l’Empire', en: 'Knight of the Empire' },
    renown: 300,
    perk: { fr: 'Les marchands lui font un prix, la garde le salue.', en: 'Merchants give a better price, the guard salutes.' },
  },
  {
    id: 'jarl',
    title: { fr: 'Jarl de Spokaheim', en: 'Jarl of Spokaheim' },
    renown: 900,
    perk: { fr: 'Peut ordonner une fête et parler au nom de la cité.', en: 'May order a feast and speak for the city.' },
  },
  {
    id: 'champion',
    title: { fr: 'Champion de l’Empereur', en: 'Champion of the Emperor' },
    renown: 1500,
    perk: { fr: 'Gloire d’arène augmentée d’un cinquième.', en: 'Arena glory increased by a fifth.' },
  },
];

// Charges de la cour : un joueur nommé à un office peut agir au nom de la Couronne.
export const OFFICES = [
  { id: 'capitaine', title: { fr: 'Capitaine de la garde', en: 'Captain of the guard' }, powers: ['alerte', 'garde'] },
  { id: 'intendant', title: { fr: 'Intendant du trésor', en: 'Steward of the treasury' }, powers: ['chantier', 'marche'] },
  { id: 'heraut', title: { fr: 'Héraut impérial', en: 'Imperial herald' }, powers: ['fete'] },
  { id: 'juge', title: { fr: 'Juge de la cité', en: 'Judge of the city' }, powers: ['amnistie'] },
];

export const FACTION_KEYS = ['couronne', 'garde', 'artisans', 'marchands', 'temple', 'peuple'];

export function newCrown() {
  return {
    emperor: null, // compte du joueur qui règne (l'Empereur Spoka)
    treasury: 0,
    taxRate: 0.1,
    decrees: [], // { id, data, until (jour), by, at }
    honours: {}, // compte → [ids]
    offices: {}, // office → compte
    unrest: 20, // 0 = la cité est heureuse, 100 = elle gronde
    petitions: [], // { id, account, name, text, at, answer, answeredAt }
    ledger: [], // dernières entrées et sorties du trésor
  };
}

export function decreeById(id) {
  return DECREES.find((d) => d.id === id) || null;
}

export function honourById(id) {
  return HONOURS.find((h) => h.id === id) || null;
}

export function officeById(id) {
  return OFFICES.find((o) => o.id === id) || null;
}

// Décrets encore en vigueur aujourd'hui.
export function activeDecrees(crown, day) {
  return (crown.decrees || []).filter((d) => !d.until || d.until >= day);
}

export function hasDecree(crown, day, id) {
  return activeDecrees(crown, day).some((d) => d.id === id);
}

// Ce que le peuple ressent, en mots — pour le portail, le panel et l'IA.
export function unrestWords(unrest, lang = 'fr') {
  const table = [
    [15, { fr: 'la cité est heureuse et le dit', en: 'the city is happy and says so' }],
    [35, { fr: 'la cité est tranquille', en: 'the city is at ease' }],
    [55, { fr: 'on grogne un peu dans les ateliers', en: 'there is some grumbling in the workshops' }],
    [75, { fr: 'le mécontentement se voit', en: 'discontent is plain to see' }],
    [101, { fr: 'la cité gronde, et ce n’est plus un murmure', en: 'the city is seething, and not quietly' }],
  ];
  for (const [max, words] of table) if (unrest < max) return words[lang] || words.fr;
  return table[table.length - 1][1][lang];
}

// Titre le plus haut porté par un joueur.
export function highestHonour(crown, account, lang = 'fr') {
  const ids = crown.honours?.[account] || [];
  const found = HONOURS.filter((h) => ids.includes(h.id));
  const best = found[found.length - 1];
  return best ? best.title[lang] || best.title.fr : null;
}

export function officeOf(crown, account, lang = 'fr') {
  const entry = Object.entries(crown.offices || {}).find(([, who]) => who === account);
  if (!entry) return null;
  const office = officeById(entry[0]);
  return office ? { id: office.id, title: office.title[lang] || office.title.fr, powers: office.powers } : null;
}

// Qui peut ordonner quoi : l'Empereur tout, un officier ce que sa charge permet.
export function mayDecree(crown, account, decreeId) {
  if (!account) return false;
  if (crown.emperor && crown.emperor === account) return true;
  const office = officeOf(crown, account);
  if (office?.powers?.includes(decreeId)) return true;
  const honours = crown.honours?.[account] || [];
  if (honours.includes('jarl') && decreeId === 'fete') return true;
  return false;
}

// Listes prêtes à afficher (panel, portail, commandes).
export const decreeList = (lang = 'fr') =>
  DECREES.map((d) => ({ id: d.id, title: d.title[lang] || d.title.fr, cost: d.cost || 0, days: d.days || 0, argument: d.argument || null }));

export const honourList = (lang = 'fr') =>
  HONOURS.map((h) => ({ id: h.id, title: h.title[lang] || h.title.fr, renown: h.renown, perk: h.perk[lang] || h.perk.fr }));

export const officeList = (lang = 'fr') =>
  OFFICES.map((o) => ({ id: o.id, title: o.title[lang] || o.title.fr, powers: o.powers }));

// Qui peut répondre aux doléances : l'Empereur, le juge, la chancellerie.
export function mayAnswer(crown, account) {
  if (!account) return false;
  if (crown.emperor === account) return true;
  const office = officeOf(crown, account);
  return !!office && ['juge', 'intendant'].includes(office.id);
}
