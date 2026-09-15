// Traduction des messages du serveur (erreurs de l'API, textes affichés en jeu).
// Le français est la langue source ; `en` associe chaque texte français à sa traduction.
import { EN_EXACT, EN_LABELS, EN_PATTERNS } from './locales/en.js';

export const requestLanguage = (req) => (String(req.headers['x-panel-lang'] || '').startsWith('fr') ? 'fr' : 'en');

export function translate(lang, text) {
  if (lang === 'fr' || typeof text !== 'string') return text;
  if (EN_EXACT[text]) return EN_EXACT[text];
  for (const [pattern, replacement] of EN_PATTERNS) {
    const match = text.match(pattern);
    // Les parties variables qui sont des noms de champs (« Quantité », « Joueur »…) sont traduites aussi.
    if (match) return replacement.replace(/\$(\d)/g, (_, i) => EN_LABELS[match[i]] ?? match[i]);
  }
  return text;
}
