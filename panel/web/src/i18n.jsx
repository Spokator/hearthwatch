import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Languages } from 'lucide-react';
import en from './locales/en.js';

// Défini ici plutôt qu'importé depuis ui.jsx, qui importe lui-même ce module.
const cx = (...c) => c.filter(Boolean).join(' ');

// Le français est la langue source : t('Texte français') renvoie la traduction ou le texte d'origine.
// Variables : t('{n} joueur(s) en ligne', { n: 3 }).
const DICTIONARIES = { en };
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];
const STORAGE_KEY = 'hearthwatch.language';

export function currentLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function translate(lang, text, vars) {
  let out = lang === 'fr' ? text : (DICTIONARIES[lang]?.[text] ?? text);
  if (vars) out = out.replace(/\{(\w+)\}/g, (match, key) => (vars[key] ?? match));
  return out;
}

const I18nContext = createContext({ lang: 'fr', setLang: () => {}, t: (text, vars) => translate('fr', text, vars) });

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(currentLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
  }, [lang]);

  const t = useCallback((text, vars) => translate(lang, text, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;

export function LanguageSwitcher({ className }) {
  const { lang, setLang } = useI18n();
  return (
    <label className={cx('inline-flex items-center gap-1.5 text-xs text-ink-500', className)}>
      <Languages className="size-3.5" />
      <select value={lang} onChange={(e) => setLang(e.target.value)} className="cursor-pointer bg-transparent text-ink-400 outline-none hover:text-ink-200" aria-label="Language">
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="bg-ink-900">
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
