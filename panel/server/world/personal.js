// Histoires personnelles : ce qu'un habitant ne demande qu'à quelqu'un en qui il a confiance.
//
// Chaque habitant garde une faveur pour plus tard. Elle n'apparaît qu'au-dessus d'un certain degré d'amitié,
// une seule fois par joueur, et elle se termine par une confidence — souvent le secret que l'habitant n'avoue
// à personne d'autre.
export const PERSONAL = [
  {
    npc: 'bjorn',
    id: 'bjorn-eirik',
    need: 45,
    title: { fr: 'Les outils d’Eirik', en: "Eirik's tools" },
    ask: {
      fr: 'Mon fils a laissé ses outils dans la Forêt noire. Rapporte-moi du cuivre et de l’étain : je lui en referai une paire, pour le jour où il rentrera.',
      en: 'My son left his tools in the Black Forest. Bring me copper and tin: I will forge him a new pair, for the day he comes home.',
    },
    kind: 'deliver',
    items: [['Copper', 10], ['Tin', 10]],
    coins: 150,
    reveal: {
      fr: 'Je l’ai chassé, tu sais. Une dispute de rien du tout, et je lui ai dit de ne plus revenir. Si tu le croises là-bas… dis-lui que la forge est froide sans lui.',
      en: 'I drove him out, you know. A quarrel over nothing, and I told him never to come back. If you meet him out there… tell him the forge is cold without him.',
    },
  },
  {
    npc: 'astrid',
    id: 'astrid-soupe',
    need: 40,
    title: { fr: 'La soupe des mauvais jours', en: 'The soup for bad days' },
    ask: {
      fr: 'Bjorn ne mange plus. Rapporte-moi de la viande et des champignons, je lui ferai la soupe qu’il aimait quand Eirik était petit.',
      en: 'Bjorn is not eating. Bring me meat and mushrooms, and I will make him the soup he loved when Eirik was small.',
    },
    kind: 'deliver',
    items: [['DeerMeat', 4], ['Mushroom', 10]],
    coins: 120,
    reveal: {
      fr: 'Sten est mon frère. Personne ne le sait, et surtout pas lui : il croit sa famille morte dans les Brumes. Garde-moi ce secret, mon petit.',
      en: 'Sten is my brother. Nobody knows, least of all him: he believes his family died in the Mistlands. Keep that for me, dear.',
    },
  },
  {
    npc: 'ingrid',
    id: 'ingrid-sceau',
    need: 55,
    title: { fr: 'Le sceau de l’Empereur', en: "The Emperor's seal" },
    ask: {
      fr: 'La chancellerie manque d’argent fin pour refaire le sceau impérial. Rapporte-le-moi discrètement : personne ne doit savoir que l’ancien s’est brisé.',
      en: 'The chancellery lacks fine silver to recast the imperial seal. Bring it to me quietly: nobody must know the old one broke.',
    },
    kind: 'deliver',
    items: [['Silver', 8]],
    coins: 300,
    reveal: {
      fr: 'L’Empereur ne se montre plus parce qu’il ne le peut plus. Je signe en son nom depuis deux hivers. Si la cité l’apprenait, elle se déchirerait.',
      en: 'The Emperor no longer shows himself because he no longer can. I have signed in his name for two winters. If the city learned it, it would tear itself apart.',
    },
  },
  {
    npc: 'hrolf',
    id: 'hrolf-loups',
    need: 40,
    title: { fr: 'Les loups de la crête', en: 'The wolves on the ridge' },
    ask: {
      fr: 'Des loups descendent la nuit jusqu’aux troupeaux. Va en abattre cinq, et la garde te devra une tournée.',
      en: 'Wolves come down to the herds at night. Put down five of them, and the guard owes you a round.',
    },
    kind: 'kill',
    targets: ['Wolf'],
    count: 5,
    coins: 220,
    reveal: {
      fr: 'J’ai perdu douze hommes aux Brumes, et j’ai donné l’ordre qui les a tués. Je monte la garde parce que dormir ne me vaut rien.',
      en: 'I lost twelve men in the Mistlands, and I gave the order that killed them. I keep watch because sleep does me no good.',
    },
  },
  {
    npc: 'solveig',
    id: 'solveig-miel',
    need: 35,
    title: { fr: 'Le miel des hauteurs', en: 'Highland honey' },
    ask: {
      fr: 'Mon hydromel de fête manque de miel. Rapporte-m’en, et je te réserverai la première corne.',
      en: 'My festival mead is short of honey. Bring me some, and the first horn is yours.',
    },
    kind: 'deliver',
    items: [['Honey', 20]],
    coins: 130,
    reveal: {
      fr: 'Je note tout ce que les gens disent quand ils ont bu. Tout. Un jour ça sauvera la cité, ou ça la brûlera.',
      en: 'I write down everything people say when they have drunk. Everything. One day it will save this city, or burn it.',
    },
  },
  {
    npc: 'dagny',
    id: 'dagny-pelerinage',
    need: 45,
    title: { fr: 'Le pèlerinage des marais', en: 'The swamp pilgrimage' },
    ask: {
      fr: 'Un autel des anciens dort dans les marais. Va jusque là-bas et reviens me dire ce que tu y as senti.',
      en: 'An altar of the old ones sleeps in the swamps. Go there, and come back to tell me what you felt.',
    },
    kind: 'visit',
    biome: 'Swamp',
    coins: 180,
    reveal: {
      fr: 'Je prie les Ases devant tout le monde, mais c’est aux dieux d’avant que je parle la nuit. Ils me répondent, et ça me terrifie.',
      en: 'I pray to the Aesir before everyone, but at night I speak to the gods from before. They answer, and it terrifies me.',
    },
  },
  {
    npc: 'gunnhild',
    id: 'gunnhild-veine',
    need: 40,
    title: { fr: 'La veine perdue', en: 'The lost vein' },
    ask: {
      fr: 'Apporte-moi du minerai de fer des marais : je veux prouver à Bjorn que ma fonte vaut la sienne.',
      en: 'Bring me iron scrap from the swamps: I mean to prove to Bjorn that my smelting matches his.',
    },
    kind: 'deliver',
    items: [['IronScrap', 15]],
    coins: 240,
    reveal: {
      fr: 'Le métal de Bjorn est meilleur, et je le sais. C’est pour ça que je crie si fort dans la fonderie.',
      en: "Bjorn's metal is better, and I know it. That is why I shout so loudly in the foundry.",
    },
  },
  {
    npc: 'ivar',
    id: 'ivar-trophee',
    need: 35,
    title: { fr: 'Le trophée du chasseur', en: "The hunter's trophy" },
    ask: {
      fr: 'Un trophée de troll, voilà ce qu’il me faut pour clouer le bec aux gardes qui se moquent de mes histoires.',
      en: 'A troll trophy, that is what I need to silence the guards who laugh at my stories.',
    },
    kind: 'deliver',
    items: [['TrophyForestTroll', 1]],
    coins: 260,
    reveal: {
      fr: 'Mes histoires de chasse sont presque toutes vraies. Presque. Celle du serpent de mer, elle, je l’ai vécue, et j’en dors mal.',
      en: 'My hunting tales are nearly all true. Nearly. The sea serpent one I lived through, and it still keeps me awake.',
    },
  },
  {
    npc: 'vigdis',
    id: 'vigdis-eclat',
    need: 50,
    title: { fr: 'Un éclat de brume', en: 'A shard of mist' },
    ask: {
      fr: 'Il me faut de l’eitr des Brumes pour terminer ma rune. C’est dangereux, je ne le demanderais pas à n’importe qui.',
      en: 'I need eitr from the Mistlands to finish my rune. It is dangerous; I would not ask just anyone.',
    },
    kind: 'deliver',
    items: [['Eitr', 10]],
    coins: 400,
    reveal: {
      fr: 'Ma rune ne sert pas à protéger la cité. Elle sert à ouvrir une porte vers les Brumes, pour aller chercher ceux qu’on y a laissés.',
      en: 'My rune is not meant to protect the city. It is meant to open a door to the Mistlands, to fetch those we left there.',
    },
  },
  {
    npc: 'halla',
    id: 'halla-plan',
    need: 40,
    title: { fr: 'Les plans de la bâtisseuse', en: "The builder's plans" },
    ask: {
      fr: 'Du bois précieux, beaucoup : je veux dresser un échafaudage digne de la statue dont je rêve.',
      en: 'Fine wood, plenty of it: I want scaffolding worthy of the statue I dream of.',
    },
    kind: 'deliver',
    items: [['FineWood', 40]],
    coins: 200,
    reveal: {
      fr: 'Le vrai plan que je garde, ce n’est pas la statue. C’est une maison pour chaque Élu, dans les murs, avec son nom sur la porte.',
      en: 'The real plan I keep is not the statue. It is a house for every Chosen, inside the walls, with their name on the door.',
    },
  },
];

// Les faveurs qu'un habitant peut demander à ce joueur maintenant.
export function personalFor(npcKey, { affinity = 0, done = [], active = [] } = {}) {
  return PERSONAL.filter((q) => q.npc === npcKey && affinity >= q.need && !done.includes(q.id) && !active.includes(q.id));
}

export function personalById(id) {
  return PERSONAL.find((q) => q.id === id) || null;
}
