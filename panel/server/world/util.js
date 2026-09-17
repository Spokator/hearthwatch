// Outils communs du monde vivant.

// Hachage stable du jeu (string.GetStableHashCode) : identifiants de PNJ, coffres de remise, pupitres.
export function stableHash(text) {
  let a = 5381;
  let b = a;
  for (let i = 0; i < text.length; i += 2) {
    a = (Math.imul(a, 33) ^ text.charCodeAt(i)) | 0;
    if (i === text.length - 1) break;
    b = (Math.imul(b, 33) ^ text.charCodeAt(i + 1)) | 0;
  }
  return (a + Math.imul(b, 1566083941)) | 0;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const distance = (a, b) => Math.hypot((a.x ?? a[0]) - (b.x ?? b[0]), (a.z ?? a[2] ?? a[1]) - (b.z ?? b[2] ?? b[1]));

// Générateur pseudo-aléatoire reproductible (mulberry32).
export function rng(seed) {
  let a = (typeof seed === 'string' ? stableHash(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (list, random = Math.random) => list[Math.floor(random() * list.length)];

// Sans accents ni casse, pour reconnaître noms et mots-clés tapés à la va-vite dans le chat.
export const fold = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Découpe un texte en bulles de chat lisibles (le jeu affiche une bulle à la fois par locuteur).
export function bubbles(text, max = 110) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  const out = [];
  let current = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if ((current + ' ' + s).trim().length <= max) current = (current + ' ' + s).trim();
    else {
      if (current) out.push(current);
      if (s.length <= max) current = s;
      else {
        // Phrase trop longue : coupe aux espaces.
        let rest = s;
        while (rest.length > max) {
          const cut = rest.lastIndexOf(' ', max);
          out.push(rest.slice(0, cut > 40 ? cut : max));
          rest = rest.slice(cut > 40 ? cut + 1 : max);
        }
        current = rest;
      }
    }
  }
  if (current) out.push(current);
  return out;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Horloge du jeu : une journée dure `dayLength` secondes réelles ; fraction 0 = minuit, 0,25 ≈ aube, 0,75 ≈ crépuscule.
export function clockOf(game) {
  const fraction = game?.fraction ?? 0.5;
  const hours = fraction * 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return {
    day: game?.day ?? 0,
    fraction,
    hour: hours,
    label: `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`,
    period: fraction < 0.22 ? 'night' : fraction < 0.3 ? 'dawn' : fraction < 0.5 ? 'morning' : fraction < 0.62 ? 'afternoon' : fraction < 0.76 ? 'evening' : fraction < 0.88 ? 'dusk' : 'night',
  };
}

export const PERIOD_FR = { night: 'la nuit', dawn: "l'aube", morning: 'la matinée', afternoon: "l'après-midi", evening: 'la soirée', dusk: 'la tombée de la nuit' };
