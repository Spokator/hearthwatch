// La Couronne, vue du portail : le trésor, les décrets, les titres, les doléances.
// Tout le monde lit cette page ; l'Empereur et ses officiers y gouvernent.
import { useCallback, useEffect, useState } from 'react';
import { Coins, Crown as CrownIcon, Gavel, Scale, ScrollText } from 'lucide-react';
import { useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { Bar, Card, Tag, cx } from './ui.jsx';

export default function Crown() {
  const t = useT();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [subjects, setSubjects] = useState([]);

  const load = useCallback(async () => {
    try {
      const data = await portalApi('/crown');
      setState(data);
      if (data.you?.emperor) portalApi('/subjects').then((r) => setSubjects(r.subjects)).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (key, path, body) => {
    setBusy(key);
    setError(null);
    try {
      setState(await portalApi(path, { method: 'POST', body }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!state) return <p className="text-center text-sm text-ink-500">{error || t('Chargement…')}</p>;
  const you = state.you || {};
  const may = new Set(you.may || []);

  return (
    <>
      <Card
        title={t('Le trésor impérial')}
        right={state.emperor ? `${t('règne')} : ${state.emperor.name}` : t('trône vacant')}
      >
        <div className="flex items-baseline gap-4">
          <span className="flex items-center gap-1.5 font-serif text-2xl text-ember-300">
            <Coins className="size-5" /> {state.treasury}
          </span>
          <span className="text-sm text-ink-400">
            {t('taxe')} {Math.round(state.taxRate * 100)} %
          </span>
        </div>
        <p className="mt-3 text-sm text-ink-300">{state.mood}</p>
        <Bar value={100 - state.unrest} max={100} tone={state.unrest > 60 ? 'ember' : 'moss'} />
        {(you.honour || you.office) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {you.honour && <Tag tone="ember">{you.honour}</Tag>}
            {you.office && <Tag tone="moss">{you.office.title}</Tag>}
          </div>
        )}
        {state.ledger?.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-ink-500">
            {state.ledger.slice(0, 4).map((entry, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{entry.reason}</span>
                <span className={entry.amount >= 0 ? 'text-moss-400' : 'text-blood-400'}>
                  {entry.amount >= 0 ? '+' : ''}
                  {entry.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('Décrets en vigueur')} right={<ScrollText className="size-4 text-ember-600" />}>
        {state.decrees.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Aucun décret. La cité vit selon la coutume.')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {state.decrees.map((decree) => (
              <li key={decree.id}>
                <span className="text-ink-200">{decree.text}</span>
                <span className="block text-xs text-ink-500">
                  {decree.by}
                  {decree.daysLeft ? ` · ${t('encore {n} jour(s)', { n: decree.daysLeft })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {may.size > 0 && (
          <div className="mt-4 space-y-3 border-t border-ink-800 pt-3">
            <p className="text-xs uppercase tracking-wide text-ink-500">{t('Ordonner')}</p>
            <div className="flex flex-wrap gap-2">
              {state.catalogue.decrees
                .filter((d) => may.has(d.id) && d.id !== 'taxe')
                .map((decree) => (
                  <button
                    key={decree.id}
                    disabled={busy === decree.id}
                    onClick={() => act(decree.id, '/crown/decree', { id: decree.id })}
                    className="rounded-full border border-ember-700/50 px-3 py-1.5 text-xs text-ember-200 transition hover:bg-ember-700/20 disabled:opacity-40"
                  >
                    {decree.title}
                    {decree.cost ? ` · ${decree.cost}` : ''}
                  </button>
                ))}
            </div>
            {may.has('taxe') && <TaxSlider rate={state.taxRate} busy={busy === 'taxe'} onSet={(rate) => act('taxe', '/crown/decree', { id: 'taxe', rate })} />}
          </div>
        )}
      </Card>

      {you.emperor && <Proclaim busy={busy === 'proclaim'} onSend={(text) => act('proclaim', '/crown/proclaim', { text })} />}

      <Card title={t('Titres et charges')} right={<CrownIcon className="size-4 text-ember-600" />}>
        {state.honours.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Personne n’a encore été élevé.')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {state.honours.map((entry) => (
              <li key={entry.account} className="flex justify-between gap-2">
                <span className="text-ink-200">{entry.name}</span>
                <span className="text-xs text-ember-300">{entry.titles.join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-3 space-y-1 text-xs text-ink-400">
          {state.offices.map((office) => (
            <li key={office.id} className="flex justify-between gap-2">
              <span>{office.title}</span>
              <span className={office.name ? 'text-ink-200' : 'text-ink-600'}>{office.name || t('vacante')}</span>
            </li>
          ))}
        </ul>
        {you.emperor && subjects.length > 0 && <Court subjects={subjects} state={state} busy={busy} act={act} />}
      </Card>

      <Card title={t('Doléances')} right={<Gavel className="size-4 text-ember-600" />}>
        {state.petitions.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Le pupitre est vide. Les habitants écrivent au château quand quelque chose les tracasse.')}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {state.petitions.slice(0, 8).map((petition) => (
              <li key={petition.id}>
                <p className="text-ink-200">
                  <span className="text-ink-400">{petition.name} :</span> {petition.text}
                </p>
                {petition.answer ? (
                  <p className={cx('text-xs', petition.answer.accept ? 'text-moss-400' : 'text-blood-400')}>
                    {petition.answer.accept ? t('accordé') : t('refusé')}
                    {petition.answer.text ? ` — ${petition.answer.text}` : ''}
                  </p>
                ) : (
                  (you.emperor || you.office) && (
                    <div className="mt-1 flex gap-2">
                      <button
                        disabled={busy === petition.id}
                        onClick={() => act(petition.id, `/crown/petition/${petition.id}`, { accept: true, coins: 100 })}
                        className="rounded-full border border-moss-500/50 px-3 py-1 text-xs text-moss-400 hover:bg-moss-500/10"
                      >
                        {t('Accorder (100 pièces)')}
                      </button>
                      <button
                        disabled={busy === petition.id}
                        onClick={() => act(petition.id, `/crown/petition/${petition.id}`, { accept: false })}
                        className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-400 hover:bg-ink-800"
                      >
                        {t('Refuser')}
                      </button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && <p className="text-center text-sm text-blood-400">{error}</p>}
    </>
  );
}

// La parole de l'Empereur, portée par le héraut jusque dans le jeu.
function Proclaim({ busy, onSend }) {
  const t = useT();
  const [text, setText] = useState('');
  return (
    <Card title={t('Proclamer')}>
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Habitants de Spokaheim…')}
          className="max-h-32 flex-1 resize-none rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-ember-600"
        />
        <button
          disabled={busy || !text.trim()}
          onClick={() => {
            onSend(text.trim());
            setText('');
          }}
          className="rounded-xl bg-ember-600 px-3 py-2 text-sm text-ink-950 disabled:opacity-40"
        >
          {t('Crier')}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-500">{t('Le héraut le criera sur la grand-place, et les habitants s’en souviendront.')}</p>
    </Card>
  );
}

// Le taux d'imposition : le seul décret qui se règle au doigt.
function TaxSlider({ rate, busy, onSet }) {
  const t = useT();
  const [value, setValue] = useState(Math.round(rate * 100));
  return (
    <div className="flex items-center gap-3">
      <Scale className="size-4 shrink-0 text-ink-500" />
      <input
        type="range"
        min="0"
        max="30"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="flex-1 accent-ember-500"
      />
      <span className="w-10 text-right text-sm text-ink-200">{value} %</span>
      <button
        disabled={busy}
        onClick={() => onSet(value / 100)}
        className="rounded-full bg-ember-600 px-3 py-1 text-xs text-ink-950 disabled:opacity-40"
      >
        {t('Fixer')}
      </button>
    </div>
  );
}

// La cour : adouber un sujet, nommer un officier.
function Court({ subjects, state, busy, act }) {
  const t = useT();
  const [who, setWho] = useState(subjects[0]?.account || '');
  return (
    <div className="mt-4 space-y-3 border-t border-ink-800 pt-3">
      <p className="text-xs uppercase tracking-wide text-ink-500">{t('Tenir cour')}</p>
      <select
        value={who}
        onChange={(e) => setWho(e.target.value)}
        className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 outline-none focus:border-ember-600"
      >
        {subjects.map((subject) => (
          <option key={subject.account} value={subject.account}>
            {subject.name} — {subject.title} ({subject.renown})
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        {state.catalogue.honours.map((honour) => (
          <button
            key={honour.id}
            disabled={busy === honour.id}
            onClick={() => act(honour.id, '/crown/honour', { account: who, honour: honour.id })}
            className="rounded-full border border-ember-700/50 px-3 py-1.5 text-xs text-ember-200 hover:bg-ember-700/20 disabled:opacity-40"
            title={honour.perk}
          >
            {t('Adouber')} : {honour.title}
          </button>
        ))}
        {state.offices.map((office) => (
          <button
            key={office.id}
            disabled={busy === office.id}
            onClick={() => act(office.id, '/crown/office', { office: office.id, account: who })}
            className="rounded-full border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40"
          >
            {t('Nommer')} : {office.title}
          </button>
        ))}
      </div>
    </div>
  );
}
