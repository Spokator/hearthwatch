// La Couronne, vue du portail.
//
// Pour un sujet : ce qu'il faut savoir du royaume — le trésor, l'impôt, l'humeur du peuple, les décrets en
// vigueur, les titres accordés, les doléances et leur sort.
// Pour l'Empereur : une salle du trône qui tient dans la main — lever l'impôt, ordonner, adouber, nommer,
// juger, proclamer. Chaque geste coûte, s'affiche publiquement, et se lit ensuite dans l'humeur de la cité.
import { useCallback, useEffect, useState } from 'react';
import { Coins, Crown as CrownIcon, Gavel, Megaphone, Scale, ScrollText, Shield, Sparkles } from 'lucide-react';
import { useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { Bar, Card, Rune, Tag, cx } from './ui.jsx';

// Une icône par décret, pour les reconnaître d'un coup d'œil.
const DECREE_ICONS = { taxe: Scale, fete: Sparkles, alerte: Shield, marche: Coins, amnistie: Gavel, chantier: ScrollText, garde: Shield };

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
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(id);
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
  const reigns = !!you.emperor;

  return (
    <>
      {/* Le sceau : qui règne, ce que pèse le trésor, ce que pense le peuple. */}
      <section className="rounded-xl border border-ember-700/40 bg-gradient-to-b from-ember-700/10 to-ink-900/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-serif text-xs uppercase tracking-[0.3em] text-ember-500">{t('La Couronne')}</p>
            <h2 className="mt-0.5 font-serif text-xl text-ink-100">{state.emperor ? state.emperor.name : t('Trône vacant')}</h2>
            <p className="text-xs text-ink-500">{reigns ? t('vous régnez sur Spokaheim') : t('Empereur de Spokaheim')}</p>
          </div>
          <CrownIcon className="size-8 text-ember-500/80" />
        </div>
        <Rune className="my-3" />
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-ink-950/60 py-2">
            <p className="font-serif text-lg text-ember-300">{state.treasury}</p>
            <p className="text-[0.65rem] uppercase tracking-wide text-ink-600">{t('trésor')}</p>
          </div>
          <div className="rounded-lg bg-ink-950/60 py-2">
            <p className="font-serif text-lg text-ink-100">{Math.round(state.taxRate * 100)} %</p>
            <p className="text-[0.65rem] uppercase tracking-wide text-ink-600">{t('impôt')}</p>
          </div>
          <div className="rounded-lg bg-ink-950/60 py-2">
            <p className={cx('font-serif text-lg', state.unrest > 60 ? 'text-blood-400' : state.unrest > 35 ? 'text-ember-300' : 'text-moss-400')}>
              {100 - state.unrest}
            </p>
            <p className="text-[0.65rem] uppercase tracking-wide text-ink-600">{t('faveur du peuple')}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-300">{state.mood}</p>
        <Bar value={100 - state.unrest} max={100} tone={state.unrest > 60 ? 'ember' : 'moss'} />
        {(you.honour || you.office) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {you.honour && <Tag tone="ember">{you.honour}</Tag>}
            {you.office && <Tag tone="moss">{you.office.title}</Tag>}
          </div>
        )}
      </section>

      {/* Gouverner : l'impôt au doigt, puis les décrets en cartes. */}
      {may.size > 0 && (
        <Card title={t('Gouverner')} right={<ScrollText className="size-4 text-ember-600" />}>
          {may.has('taxe') && <TaxDial rate={state.taxRate} busy={busy === 'taxe'} onSet={(rate) => act('taxe', '/crown/decree', { id: 'taxe', rate })} />}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {state.catalogue.decrees
              .filter((decree) => may.has(decree.id) && decree.id !== 'taxe')
              .map((decree) => {
                const Icon = DECREE_ICONS[decree.id] || ScrollText;
                const poor = decree.cost > state.treasury;
                const active = state.decrees.some((d) => d.id === decree.id);
                return (
                  <button
                    key={decree.id}
                    disabled={busy === decree.id || poor}
                    onClick={() => act(decree.id, '/crown/decree', { id: decree.id })}
                    className={cx(
                      'rounded-xl border p-3 text-left transition',
                      active ? 'border-ember-600/60 bg-ember-700/15' : 'border-ink-800 bg-ink-950/50 hover:border-ember-700/50',
                      poor && 'opacity-40',
                    )}
                  >
                    <Icon className="mb-1.5 size-4 text-ember-400" />
                    <span className="block text-sm leading-tight text-ink-100">{decree.title}</span>
                    <span className="mt-1 block text-[0.7rem] text-ink-500">
                      {decree.cost ? `${decree.cost} ${t('pièces')}` : t('sans frais')}
                      {decree.days ? ` · ${decree.days} ${t('j')}` : ''}
                      {active ? ` · ${t('en vigueur')}` : ''}
                    </span>
                  </button>
                );
              })}
          </div>
        </Card>
      )}

      {reigns && <Proclaim busy={busy === 'proclaim'} onSend={(text) => act('proclaim', '/crown/proclaim', { text })} />}

      <Card title={t('Décrets en vigueur')} right={`${state.decrees.length}`}>
        {state.decrees.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Aucun décret. La cité vit selon la coutume.')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {state.decrees.map((decree) => (
              <li key={decree.id} className="border-l-2 border-ember-700/50 pl-3">
                <span className="text-ink-200">{decree.text}</span>
                <span className="block text-xs text-ink-500">
                  {decree.by}
                  {decree.daysLeft ? ` · ${t('encore {n} jour(s)', { n: decree.daysLeft })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {state.ledger?.length > 0 && (
          <>
            <Rune className="my-3" />
            <p className="mb-1 text-xs uppercase tracking-wide text-ink-600">{t('Le trésor, ces derniers temps')}</p>
            <ul className="space-y-1 text-xs text-ink-500">
              {state.ledger.slice(0, 5).map((entry, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{entry.reason}</span>
                  <span className={entry.amount >= 0 ? 'text-moss-400' : 'text-blood-400'}>
                    {entry.amount >= 0 ? '+' : ''}
                    {entry.amount}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title={t('Doléances')} right={<Gavel className="size-4 text-ember-600" />}>
        {state.petitions.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Le pupitre est vide. Les habitants écrivent au château quand quelque chose les tracasse.')}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {state.petitions.slice(0, 8).map((petition) => (
              <Petition
                key={petition.id}
                petition={petition}
                may={reigns || you.office?.id === 'juge'}
                busy={busy === petition.id}
                onAnswer={(accept, answer, coins) => act(petition.id, `/crown/petition/${petition.id}`, { accept, answer, coins })}
              />
            ))}
          </ul>
        )}
      </Card>

      {state.outlaws?.length > 0 && (
        <Card title={t('Hors-la-loi')} right={<Shield className="size-4 text-blood-400" />}>
          <ul className="space-y-2 text-sm">
            {state.outlaws.map((outlaw) => (
              <li key={outlaw.account} className="flex items-center justify-between gap-2">
                <span>
                  <span className="text-ink-100">{outlaw.name}</span>
                  <span className="block text-xs text-ink-500">
                    {outlaw.jail
                      ? `${t('au')} ${outlaw.jail.kind}`
                      : outlaw.wanted
                        ? `${t('recherché')} · ${outlaw.bounty} ${t('pièces')}`
                        : `${outlaw.crimes} ${t('délit(s)')}`}
                  </span>
                </span>
                {(reigns || you.office?.id === 'juge') && (outlaw.wanted || outlaw.jail) && (
                  <button
                    disabled={busy === outlaw.account}
                    onClick={() => act(outlaw.account, '/crown/pardon', { account: outlaw.account })}
                    className="rounded-full border border-moss-500/50 px-3 py-1 text-xs text-moss-400 hover:bg-moss-500/10"
                  >
                    {t('Gracier')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('Titres et charges')} right={<Sparkles className="size-4 text-ember-600" />}>
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
        {reigns && subjects.length > 0 && <Court subjects={subjects} state={state} busy={busy} act={act} />}
      </Card>

      {error && <p className="text-center text-sm text-blood-400">{error}</p>}
    </>
  );
}

// L'impôt : on le règle au doigt, et on lit tout de suite ce qu'il coûtera en faveur.
function TaxDial({ rate, busy, onSet }) {
  const t = useT();
  const [value, setValue] = useState(Math.round(rate * 100));
  const mood =
    value <= 8 ? t('le peuple applaudit') : value <= 15 ? t('le peuple accepte') : value <= 22 ? t('on grogne aux ateliers') : t('la colère monte');
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-950/50 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-200">{t('Impôt impérial')}</span>
        <span className="font-serif text-lg text-ember-300">{value} %</span>
      </div>
      <input type="range" min="0" max="30" value={value} onChange={(e) => setValue(Number(e.target.value))} className="mt-2 w-full accent-ember-500" />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-ink-500">{mood}</span>
        <button
          disabled={busy || value === Math.round(rate * 100)}
          onClick={() => onSet(value / 100)}
          className="rounded-full bg-ember-600 px-3 py-1 text-xs text-ink-950 disabled:opacity-40"
        >
          {t('Décréter')}
        </button>
      </div>
    </div>
  );
}

// La parole de l'Empereur, portée par le héraut jusque dans le jeu.
function Proclaim({ busy, onSend }) {
  const t = useT();
  const [text, setText] = useState('');
  return (
    <Card title={t('Proclamer')} right={<Megaphone className="size-4 text-ember-600" />}>
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

// Une doléance : on l'accorde avec une bourse, ou on la refuse, et l'on peut répondre d'un mot.
function Petition({ petition, may, busy, onAnswer }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [coins, setCoins] = useState(100);
  return (
    <li>
      <p className="text-ink-200">
        <span className="text-ink-400">{petition.name} :</span> {petition.text}
      </p>
      {petition.answer ? (
        <p className={cx('text-xs', petition.answer.accept ? 'text-moss-400' : 'text-blood-400')}>
          {petition.answer.accept ? t('accordé') : t('refusé')}
          {petition.answer.text ? ` — ${petition.answer.text}` : ''}
        </p>
      ) : may ? (
        <div className="mt-1.5">
          {open ? (
            <div className="space-y-2 rounded-lg border border-ink-800 bg-ink-950/60 p-2">
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={t('Un mot de la Couronne (facultatif)')}
                className="w-full rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100 outline-none focus:border-ember-600"
              />
              <label className="flex items-center gap-2 text-xs text-ink-400">
                {t('Bourse')}
                <input
                  type="number"
                  value={coins}
                  min="0"
                  step="50"
                  onChange={(e) => setCoins(Number(e.target.value))}
                  className="w-20 rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100 outline-none"
                />
              </label>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => onAnswer(true, answer, coins)}
                  className="rounded-full border border-moss-500/50 px-3 py-1 text-xs text-moss-400 hover:bg-moss-500/10"
                >
                  {t('Accorder')}
                </button>
                <button
                  disabled={busy}
                  onClick={() => onAnswer(false, answer, 0)}
                  className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-400 hover:bg-ink-800"
                >
                  {t('Refuser')}
                </button>
                <button onClick={() => setOpen(false)} className="ml-auto text-xs text-ink-600">
                  {t('Fermer')}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setOpen(true)} className="rounded-full border border-ember-700/50 px-3 py-1 text-xs text-ember-200 hover:bg-ember-700/20">
              {t('Trancher')}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

// La cour : adouber un sujet, lui confier une charge.
function Court({ subjects, state, busy, act }) {
  const t = useT();
  const [who, setWho] = useState(subjects[0]?.account || '');
  const chosen = subjects.find((s) => s.account === who);
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
      <div className="grid gap-2">
        {state.catalogue.honours.map((honour) => {
          const short = chosen && chosen.renown < honour.renown;
          return (
            <button
              key={honour.id}
              disabled={busy === honour.id}
              onClick={() => act(honour.id, '/crown/honour', { account: who, honour: honour.id })}
              className={cx(
                'rounded-xl border p-2.5 text-left transition',
                short ? 'border-ink-800' : 'border-ember-700/50 hover:bg-ember-700/15',
              )}
            >
              <span className="block text-sm text-ink-100">{honour.title}</span>
              <span className="block text-[0.7rem] text-ink-500">
                {honour.perk}
                {short ? ` · ${t('renommée conseillée')} ${honour.renown}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
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
