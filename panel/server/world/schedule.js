// Routines : où est chaque habitant et ce qu'il fait, selon l'heure du jeu, son métier et le calendrier de la ville.
//
// Un profil est une liste de créneaux [début (fraction du jour, 0 = minuit), activité, lieu]. Lieux :
//   work (son poste), home, tavern (siège à la brasserie), church (banc de l'église), plaza, castle-salon, garden,
//   market (autour de la halle), walls (un poste de garde).
// Calendrier : jour sacré (tous les 7 jours, sermon à l'aube), jour du marché (7 jours, décalé de 3), fête de
// l'hydromel (tous les 10 jours, le soir).

export const PROFILES = {
  noble: [[0, 'sleep', 'home'], [0.26, 'work', 'work'], [0.5, 'eat', 'castle-salon'], [0.55, 'work', 'work'], [0.72, 'wander', 'castle-salon'], [0.86, 'sleep', 'home']],
  captain: [[0, 'sleep', 'home'], [0.24, 'guard', 'work'], [0.4, 'wander', 'plaza'], [0.48, 'eat', 'tavern'], [0.54, 'guard', 'walls'], [0.7, 'tavern', 'tavern'], [0.84, 'sleep', 'home']],
  'guard-day': [[0, 'sleep', 'home'], [0.25, 'guard', 'work'], [0.5, 'eat', 'tavern'], [0.54, 'guard', 'work'], [0.76, 'tavern', 'tavern'], [0.88, 'sleep', 'home']],
  'guard-night': [[0, 'guard', 'work'], [0.3, 'eat', 'tavern'], [0.36, 'sleep', 'home'], [0.62, 'pray', 'church'], [0.7, 'guard', 'work']],
  artisan: [[0, 'sleep', 'home'], [0.25, 'eat', 'home'], [0.29, 'work', 'work'], [0.5, 'eat', 'tavern'], [0.55, 'work', 'work'], [0.72, 'tavern', 'tavern'], [0.86, 'sleep', 'home']],
  apprentice: [[0, 'sleep', 'home'], [0.27, 'work', 'work'], [0.45, 'wander', 'plaza'], [0.52, 'work', 'work'], [0.68, 'wander', 'market'], [0.76, 'tavern', 'tavern'], [0.9, 'sleep', 'home']],
  tavern: [[0, 'sleep', 'home'], [0.3, 'wander', 'market'], [0.36, 'work', 'work'], [0.95, 'sleep', 'home']],
  brewer: [[0, 'sleep', 'home'], [0.28, 'work', 'work'], [0.66, 'tavern', 'tavern'], [0.92, 'sleep', 'home']],
  bard: [[0, 'sleep', 'home'], [0.35, 'wander', 'plaza'], [0.5, 'eat', 'tavern'], [0.56, 'wander', 'market'], [0.66, 'work', 'work'], [0.94, 'sleep', 'home']],
  priest: [[0, 'sleep', 'home'], [0.22, 'work', 'work'], [0.5, 'eat', 'home'], [0.55, 'work', 'work'], [0.78, 'pray', 'work'], [0.86, 'sleep', 'home']],
  acolyte: [[0, 'sleep', 'home'], [0.22, 'work', 'work'], [0.5, 'eat', 'tavern'], [0.54, 'work', 'work'], [0.84, 'sleep', 'home']],
  curator: [[0, 'sleep', 'home'], [0.28, 'work', 'work'], [0.52, 'eat', 'home'], [0.56, 'work', 'work'], [0.74, 'wander', 'plaza'], [0.82, 'sleep', 'home']],
  arena: [[0, 'sleep', 'home'], [0.3, 'work', 'work'], [0.5, 'eat', 'tavern'], [0.55, 'work', 'work'], [0.7, 'tavern', 'tavern'], [0.92, 'sleep', 'home']],
  keeper: [[0, 'sleep', 'home'], [0.27, 'work', 'work'], [0.5, 'eat', 'home'], [0.55, 'work', 'work'], [0.78, 'wander', 'plaza'], [0.87, 'sleep', 'home']],
  merchant: [[0, 'sleep', 'home'], [0.26, 'work', 'work'], [0.68, 'tavern', 'tavern'], [0.84, 'sleep', 'home']],
  crier: [[0, 'sleep', 'home'], [0.27, 'work', 'work'], [0.48, 'eat', 'tavern'], [0.53, 'work', 'work'], [0.7, 'tavern', 'tavern'], [0.86, 'sleep', 'home']],
  farmer: [[0, 'sleep', 'home'], [0.23, 'work', 'work'], [0.48, 'eat', 'home'], [0.53, 'work', 'work'], [0.72, 'tavern', 'tavern'], [0.84, 'sleep', 'home']],
  'lazy-farmer': [[0, 'sleep', 'home'], [0.32, 'work', 'work'], [0.42, 'sleep', 'garden'], [0.5, 'eat', 'home'], [0.58, 'work', 'work'], [0.66, 'tavern', 'tavern'], [0.9, 'sleep', 'home']],
  hunter: [[0, 'sleep', 'home'], [0.22, 'work', 'work'], [0.6, 'wander', 'market'], [0.66, 'tavern', 'tavern'], [0.8, 'sleep', 'home']],
  fisher: [[0, 'sleep', 'home'], [0.2, 'work', 'work'], [0.56, 'eat', 'tavern'], [0.62, 'work', 'work'], [0.74, 'tavern', 'tavern'], [0.9, 'sleep', 'home']],
  scholar: [[0, 'work', 'work'], [0.1, 'sleep', 'home'], [0.36, 'work', 'work'], [0.6, 'wander', 'church'], [0.7, 'work', 'work']],
  herbalist: [[0, 'sleep', 'home'], [0.24, 'wander', 'garden'], [0.34, 'work', 'work'], [0.66, 'wander', 'church'], [0.76, 'tavern', 'tavern'], [0.86, 'sleep', 'home']],
  vagrant: [[0, 'sleep', 'home'], [0.28, 'wander', 'plaza'], [0.45, 'wander', 'market'], [0.58, 'wander', 'plaza'], [0.72, 'tavern', 'tavern'], [0.8, 'sleep', 'home']],
};

export const ACTIVITY_WORDS = {
  sleep: { fr: 'dort', en: 'sleeping' },
  work: { fr: 'travaille', en: 'working' },
  guard: { fr: 'monte la garde', en: 'on guard' },
  eat: { fr: 'mange', en: 'eating' },
  tavern: { fr: 'boit un verre à la brasserie', en: 'having a drink at the mead hall' },
  pray: { fr: 'prie', en: 'praying' },
  wander: { fr: 'flâne', en: 'strolling' },
  festival: { fr: 'fait la fête', en: 'celebrating' },
  sermon: { fr: 'écoute le sermon', en: 'listening to the sermon' },
  preach: { fr: 'prêche', en: 'preaching' },
  idle: { fr: 'se repose', en: 'resting' },
};

export function calendar(day) {
  return {
    holy: day % 7 === 0,
    market: day % 7 === 3,
    festival: day % 10 === 5,
  };
}

// Activité et lieu d'un habitant à une fraction du jour donnée.
export function slotFor(npc, fraction, day) {
  const profile = PROFILES[npc.schedule] || PROFILES.artisan;
  let slot = profile[0];
  for (const s of profile) if (fraction >= s[0]) slot = s;
  let [, activity, place] = slot;
  const cal = calendar(day);
  const onDuty = activity === 'guard' || (activity === 'work' && (npc.schedule === 'tavern' || npc.schedule === 'brewer'));
  if (cal.holy && fraction >= 0.23 && fraction < 0.31) {
    if (npc.key === 'dagny') return { activity: 'preach', place: 'work' };
    if (!onDuty && activity !== 'sleep') return { activity: 'sermon', place: 'church' };
  }
  if (cal.festival && fraction >= 0.66 && fraction < 0.9 && !onDuty) return { activity: 'festival', place: 'tavern' };
  if (cal.market && fraction >= 0.4 && fraction < 0.62 && (activity === 'wander' || activity === 'eat')) return { activity: 'wander', place: 'market' };
  return { activity, place };
}
