// Grands chantiers : des buts communs à tout le serveur, payés en matériaux par les joueurs.
//
// Un chantier s'ouvre tout seul quand le précédent est fini. On y contribue en déposant les matériaux dans le
// coffre du chantier (à l'atelier des bâtisseurs) : le serveur les prend, compte la part de chacun, et quand la
// dernière planche est livrée la cité change vraiment — la cloche sonne, la garde patrouille, la mine rouvre.
export const PROJECT_COUNTER = 'workshop';

export const PROJECTS = [
  {
    id: 'cloche',
    flag: 'projet_cloche',
    title: { fr: 'La cloche de l’église', en: 'The church bell' },
    story: {
      fr: 'La cloche des Ases est fêlée depuis l’exil. Dagny veut l’entendre sonner à l’aube.',
      en: 'The bell of the Aesir has been cracked since the exile. Dagny wants to hear it at dawn again.',
    },
    effect: { fr: 'La cloche sonne à chaque aube et double la faveur gagnée au sermon.', en: 'The bell rings at every dawn and doubles the favour earned at the sermon.' },
    needs: [['Bronze', 20], ['FineWood', 30], ['Coins', 200]],
    renown: 25,
    giver: 'dagny',
  },
  {
    id: 'garde',
    flag: 'projet_garde',
    title: { fr: 'Le guet renforcé', en: 'A stronger watch' },
    story: {
      fr: 'Hrolf manque de bois pour les palissades et de cuir pour les boucliers de ses hommes.',
      en: 'Hrolf lacks wood for the palisades and leather for his men’s shields.',
    },
    effect: { fr: 'Les raids nocturnes sont nettement moins nombreux.', en: 'Night raids come in much smaller numbers.' },
    needs: [['Wood', 200], ['LeatherScraps', 40], ['Coins', 300]],
    renown: 30,
    giver: 'hrolf',
  },
  {
    id: 'mine',
    flag: 'projet_mine',
    title: { fr: 'La mine rouverte', en: 'The mine reopened' },
    story: {
      fr: 'Gunnhild jure qu’il reste du minerai sous la colline : il faut étayer la galerie.',
      en: 'Gunnhild swears there is ore left under the hill: the gallery must be shored up.',
    },
    effect: { fr: 'La fonderie vend du métal et ses prix baissent.', en: 'The foundry sells metal and its prices drop.' },
    needs: [['Stone', 150], ['Coal', 60], ['RoundLog', 40]],
    renown: 30,
    giver: 'gunnhild',
  },
  {
    id: 'statue',
    flag: 'projet_statue',
    title: { fr: 'La statue de l’Empereur', en: 'The Emperor’s statue' },
    story: {
      fr: 'Halla rêve d’une statue de Spoka sur la grand-place, visible depuis les remparts.',
      en: 'Halla dreams of a statue of Spoka on the main square, visible from the ramparts.',
    },
    effect: { fr: 'La fierté de la cité : toute renommée gagnée augmente d’un cinquième.', en: 'The city’s pride: every renown gained increases by a fifth.' },
    needs: [['Stone', 250], ['Bronze', 40], ['Coins', 800]],
    renown: 50,
    giver: 'halla',
  },
];

export function projectById(id) {
  return PROJECTS.find((p) => p.id === id) || null;
}

// Le chantier suivant : le premier qui n'est pas encore achevé.
export function nextProject(flags = {}) {
  return PROJECTS.find((p) => !flags[p.flag]) || null;
}

// État lisible d'un chantier en cours (pour le portail, le panel et la commande !chantier).
export function projectView(project, progress = {}, lang = 'fr', itemName = (i) => i) {
  if (!project) return null;
  const parts = project.needs.map(([item, count]) => ({
    item,
    name: itemName(item, count),
    need: count,
    done: Math.min(progress[item] || 0, count),
  }));
  const total = parts.reduce((sum, p) => sum + p.need, 0);
  const done = parts.reduce((sum, p) => sum + p.done, 0);
  return {
    id: project.id,
    title: project.title[lang] || project.title.fr,
    story: project.story[lang] || project.story.fr,
    effect: project.effect[lang] || project.effect.fr,
    giver: project.giver,
    parts,
    percent: total ? Math.round((done / total) * 100) : 0,
    complete: parts.every((p) => p.done >= p.need),
  };
}
