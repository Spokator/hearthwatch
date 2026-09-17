// Psyché des habitants : besoins, émotions, humeur, souvenirs, relations.
//
// Besoins (0 à 1, 1 = comblé) : énergie, faim, vie sociale, amusement. Ils baissent avec le temps et remontent selon
// l'activité (dormir, manger, boire à la brasserie, bavarder…).
// Émotions (0 à 1) : joie, tristesse, colère, peur, fierté, gratitude, surprise, dégoût. Un événement les fait
// monter (« appraisal »), puis elles reviennent vers la ligne de base de la personnalité ; le névrosisme ralentit
// l'oubli des émotions négatives, l'extraversion accélère le retour de la joie.
import { clamp, pick } from './util.js';

export const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'pride', 'gratitude', 'surprise', 'disgust'];

export const EMOTION_WORDS = {
  joy: { fr: 'joyeux', frf: 'joyeuse', en: 'joyful' },
  sadness: { fr: 'triste', frf: 'triste', en: 'sad' },
  anger: { fr: 'en colère', frf: 'en colère', en: 'angry' },
  fear: { fr: 'inquiet', frf: 'inquiète', en: 'worried' },
  pride: { fr: 'fier', frf: 'fière', en: 'proud' },
  gratitude: { fr: 'reconnaissant', frf: 'reconnaissante', en: 'grateful' },
  surprise: { fr: 'surpris', frf: 'surprise', en: 'surprised' },
  disgust: { fr: 'dégoûté', frf: 'dégoûtée', en: 'disgusted' },
};

const NEED_WORDS = {
  energy: { fr: 'fatigué', frf: 'fatiguée', en: 'tired' },
  hunger: { fr: 'affamé', frf: 'affamée', en: 'hungry' },
  social: { fr: 'seul', frf: 'seule', en: 'lonely' },
  fun: { fr: "d'humeur morne", frf: "d'humeur morne", en: 'bored' },
};

// Correspondance des émotions libres renvoyées par l'IA.
const EMOTION_ALIASES = {
  joie: 'joy', joy: 'joy', heureux: 'joy', content: 'joy', amuse: 'joy', amusement: 'joy', happy: 'joy',
  tristesse: 'sadness', triste: 'sadness', sadness: 'sadness', sad: 'sadness', melancolie: 'sadness',
  colere: 'anger', anger: 'anger', agace: 'anger', irritation: 'anger', angry: 'anger', rage: 'anger',
  peur: 'fear', fear: 'fear', inquietude: 'fear', inquiet: 'fear', anxiete: 'fear', worried: 'fear',
  fierte: 'pride', pride: 'pride', fier: 'pride', proud: 'pride',
  gratitude: 'gratitude', reconnaissance: 'gratitude', grateful: 'gratitude', merci: 'gratitude',
  surprise: 'surprise', etonnement: 'surprise', surprised: 'surprise',
  degout: 'disgust', disgust: 'disgust', mepris: 'disgust',
};

export function emotionKey(word) {
  const w = String(word || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return EMOTION_ALIASES[w] || null;
}

export function newMind(traits) {
  return {
    needs: { energy: 0.8, hunger: 0.7, social: 0.6, fun: 0.6 },
    emotions: Object.fromEntries(EMOTIONS.map((e) => [e, baseline(traits, e)])),
    cause: null,
    activity: 'idle',
  };
}

function baseline(traits, emotion) {
  const { e = 0.5, a = 0.5, n = 0.5 } = traits || {};
  if (emotion === 'joy') return clamp(0.15 + 0.25 * e + 0.1 * a - 0.2 * n, 0, 0.6);
  if (emotion === 'fear') return clamp(0.05 + 0.15 * n, 0, 0.3);
  if (emotion === 'sadness') return clamp(0.02 + 0.1 * n, 0, 0.2);
  return 0;
}

// Effets des activités sur les besoins, par heure de jeu.
const ACTIVITY_NEEDS = {
  sleep: { energy: 0.14, hunger: -0.02, social: -0.01, fun: 0 },
  work: { energy: -0.05, hunger: -0.05, social: -0.02, fun: -0.02 },
  guard: { energy: -0.05, hunger: -0.05, social: -0.03, fun: -0.04 },
  eat: { energy: 0.01, hunger: 0.35, social: 0.08, fun: 0.04 },
  tavern: { energy: -0.02, hunger: 0.15, social: 0.2, fun: 0.2 },
  pray: { energy: 0, hunger: -0.03, social: 0.05, fun: 0 },
  wander: { energy: -0.03, hunger: -0.04, social: 0.02, fun: 0.05 },
  festival: { energy: -0.04, hunger: 0.2, social: 0.3, fun: 0.35 },
  idle: { energy: -0.02, hunger: -0.04, social: -0.02, fun: -0.02 },
};

export function tickMind(npc, hours) {
  const mind = npc.mind;
  const effect = ACTIVITY_NEEDS[mind.activity] || ACTIVITY_NEEDS.idle;
  const extravert = npc.traits?.e ?? 0.5;
  for (const need of Object.keys(mind.needs)) {
    let delta = effect[need] ?? -0.03;
    if (need === 'social' && delta < 0) delta *= 0.5 + extravert;
    mind.needs[need] = clamp(mind.needs[need] + delta * hours, 0, 1);
  }
  // Retour des émotions vers la ligne de base.
  const n = npc.traits?.n ?? 0.5;
  for (const emotion of EMOTIONS) {
    const base = baseline(npc.traits, emotion);
    const negative = emotion === 'sadness' || emotion === 'anger' || emotion === 'fear' || emotion === 'disgust';
    const halfLife = negative ? 2 + 6 * n : 3 - 1.5 * extravert + 1; // heures de jeu
    const k = 1 - Math.pow(0.5, hours / halfLife);
    mind.emotions[emotion] += (base - mind.emotions[emotion]) * k;
  }
  // Besoins criants → légère humeur négative.
  if (mind.needs.hunger < 0.15) mind.emotions.anger = clamp(mind.emotions.anger + 0.02 * hours, 0, 1);
  if (mind.needs.social < 0.15) mind.emotions.sadness = clamp(mind.emotions.sadness + 0.02 * hours * extravert, 0, 1);
}

// Un événement touche l'habitant : l'émotion monte selon la personnalité.
export function appraise(npc, emotion, intensity, cause) {
  const key = EMOTIONS.includes(emotion) ? emotion : emotionKey(emotion);
  if (!key) return;
  const { n = 0.5, e = 0.5, a = 0.5 } = npc.traits || {};
  let scale = 1;
  if (key === 'sadness' || key === 'fear') scale = 0.6 + 0.8 * n;
  if (key === 'anger') scale = 0.7 + 0.6 * n - 0.4 * (a - 0.5);
  if (key === 'joy' || key === 'gratitude') scale = 0.7 + 0.5 * e;
  const mind = npc.mind;
  mind.emotions[key] = clamp(mind.emotions[key] + intensity * scale, 0, 1);
  // Les émotions opposées reculent.
  if (key === 'joy' || key === 'gratitude' || key === 'pride') {
    mind.emotions.sadness *= 1 - intensity * 0.5;
    mind.emotions.anger *= 1 - intensity * 0.4;
  }
  if (key === 'anger' || key === 'sadness' || key === 'fear') mind.emotions.joy *= 1 - intensity * 0.5;
  if (intensity >= 0.15 && cause) mind.cause = { emotion: key, text: cause, t: Date.now() };
}

// Émotion dominante (ou besoin criant) → étiquette d'humeur.
export function mood(npc, lang = 'fr') {
  const mind = npc.mind;
  const fem = npc.gender === 'f';
  let best = null;
  for (const emotion of EMOTIONS) if (!best || mind.emotions[emotion] > mind.emotions[best]) best = emotion;
  const value = mind.emotions[best];
  const word = (w) => (lang === 'en' ? w.en : fem ? w.frf : w.fr);
  const needs = Object.entries(mind.needs).filter(([, v]) => v < 0.2).sort((x, y) => x[1] - y[1]);
  let label;
  let key;
  if (value >= 0.35 || (best === 'joy' && value >= 0.25)) {
    key = best;
    label = word(EMOTION_WORDS[best]);
  } else if (needs.length) {
    key = needs[0][0];
    label = word(NEED_WORDS[needs[0][0]]);
  } else {
    key = 'calm';
    label = lang === 'en' ? 'calm' : fem ? 'sereine' : 'serein';
  }
  const cause = mind.cause && Date.now() - mind.cause.t < 45 * 60000 && mind.cause.emotion === key ? mind.cause.text : null;
  return { key, label, intensity: value, cause };
}

// Valence globale (-1 à 1) : sert aux prix, à la patience et à la chaleur des réponses.
export function valence(npc) {
  const e = npc.mind.emotions;
  return clamp(e.joy + e.pride * 0.6 + e.gratitude * 0.7 - e.sadness - e.anger - e.fear * 0.7 - e.disgust * 0.6, -1, 1);
}

// ---------- Souvenirs ----------

export function remember(npc, text, { importance = 2, about = [], shareable = false, emotion = null } = {}) {
  npc.memories = npc.memories || [];
  npc.memories.push({ t: Date.now(), text, importance, about, shareable, emotion });
  if (npc.memories.length > 60) {
    // Oublie d'abord les souvenirs anciens et peu importants.
    npc.memories.sort((x, y) => y.importance * 1e13 + y.t - (x.importance * 1e13 + x.t));
    npc.memories.length = 45;
    npc.memories.sort((x, y) => x.t - y.t);
  }
}

// Souvenirs utiles pour une conversation : ceux qui concernent l'interlocuteur, puis les plus marquants et récents.
export function recall(npc, about, count = 5) {
  const now = Date.now();
  const score = (m) => m.importance * 2 + (m.about?.includes(about) ? 6 : 0) - (now - m.t) / (6 * 3600000);
  return [...(npc.memories || [])].sort((x, y) => score(y) - score(x)).slice(0, count);
}

// Rumeur : un habitant raconte à un autre un souvenir partageable qu'il ne connaît pas encore.
export function gossip(teller, listener, random = Math.random) {
  const known = new Set((listener.memories || []).map((m) => m.origin || m.text));
  const candidates = (teller.memories || []).filter((m) => m.shareable && !known.has(m.origin || m.text) && Date.now() - m.t < 3 * 24 * 3600000);
  if (!candidates.length) return null;
  const memory = pick(candidates, random);
  listener.memories = listener.memories || [];
  listener.memories.push({
    t: Date.now(),
    text: `${teller.name.split(' ')[0]} m'a raconté : ${memory.text}`,
    importance: Math.max(1, memory.importance - 1),
    about: memory.about,
    shareable: memory.importance >= 3,
    origin: memory.origin || memory.text,
  });
  return memory;
}

// ---------- Relations avec les joueurs ----------

export function relationWith(npc, account) {
  npc.relations = npc.relations || {};
  if (!npc.relations[account]) npc.relations[account] = { affinity: 0, trust: 20, talks: 0, facts: [], lastTalk: 0, history: [] };
  return npc.relations[account];
}

export function adjustAffinity(npc, account, delta) {
  const rel = relationWith(npc, account);
  // Les agréables pardonnent plus vite, les rancuniers (peu agréables) retiennent les offenses.
  const a = npc.traits?.a ?? 0.5;
  const scaled = delta < 0 ? delta * (1.4 - a * 0.8) : delta * (0.7 + a * 0.6);
  rel.affinity = clamp(rel.affinity + scaled, -100, 100);
  return rel.affinity;
}

export function learnFact(npc, account, fact) {
  const rel = relationWith(npc, account);
  const clean = String(fact || '').trim().slice(0, 160);
  if (!clean || rel.facts.includes(clean)) return;
  rel.facts.push(clean);
  if (rel.facts.length > 12) rel.facts.shift();
}
