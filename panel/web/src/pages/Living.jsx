import { useEffect, useState } from 'react';
import { Bot, Coins, Drama, MessageSquareText, Newspaper, ScrollText, Send, Settings2, Sparkles, UserRound, Users } from 'lucide-react';
import { api, formatDate, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader } from '../status.jsx';
import { Badge, Button, Card, Empty, Field, Input, Meter, Modal, Select, Spinner, Stat, Toggle, cx, useAction } from '../ui.jsx';

const TABS = [
  ['overview', 'Aperçu', Sparkles],
  ['npcs', 'Habitants', Users],
  ['players', 'Aventuriers', UserRound],
  ['economy', 'Économie', Coins],
  ['talks', 'Conversations', MessageSquareText],
  ['settings', 'Réglages', Settings2],
];

const MOOD_TONE = { joy: 'green', pride: 'green', gratitude: 'green', calm: 'neutral', sadness: 'blue', fear: 'amber', anger: 'red', disgust: 'red', surprise: 'amber', energy: 'neutral', hunger: 'amber', social: 'blue', fun: 'neutral' };
const EMOTIONS = [['joy', 'Joie'], ['sadness', 'Tristesse'], ['anger', 'Colère'], ['fear', 'Inquiétude'], ['pride', 'Fierté'], ['gratitude', 'Gratitude'], ['surprise', 'Surprise'], ['disgust', 'Dégoût']];
const NEEDS = [['energy', 'Énergie'], ['hunger', 'Satiété'], ['social', 'Vie sociale'], ['fun', 'Amusement']];
const ACTIVITIES = { sleep: 'dort', work: 'travaille', guard: 'monte la garde', eat: 'mange', tavern: 'à la brasserie', pray: 'prie', wander: 'flâne', festival: 'fait la fête', sermon: 'au sermon', preach: 'prêche', idle: 'se repose' };

export default function Living() {
  const t = useT();
  const [tab, setTab] = useState('overview');
  const { data: status, reload } = useApi('/living', { interval: 4000 });
  return (
    <>
      <PageHeader
        title={t('Monde vivant')}
        description={t('Les habitants de Spokaheim vivent leur vie : métiers, routines, émotions, souvenirs, économie et quêtes. Les joueurs leur parlent dans le chat du jeu ; une IA leur donne la parole.')}
      />
      <OfflineNotice />
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map(([key, label, Icon]) => (
          <Button key={key} variant={tab === key ? 'primary' : 'secondary'} size="sm" icon={Icon} onClick={() => setTab(key)}>
            {t(label)}
          </Button>
        ))}
      </div>
      {!status ? (
        <Spinner />
      ) : tab === 'overview' ? (
        <Overview status={status} />
      ) : tab === 'npcs' ? (
        <Npcs />
      ) : tab === 'players' ? (
        <Players />
      ) : tab === 'economy' ? (
        <Economy />
      ) : tab === 'talks' ? (
        <Talks />
      ) : (
        <SettingsTab status={status} reload={reload} />
      )}
    </>
  );
}

function Overview({ status }) {
  const t = useT();
  const cal = status.clock?.calendar || {};
  return (
    <div className="space-y-6">
      {!status.online && (
        <Card>
          <Empty icon={Drama} title={t('Le monde est en pause')}>
            {t('Le plugin ne répond pas : les habitants reprendront vie au démarrage du serveur.')}
          </Empty>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('Heure du jeu')} value={status.clock ? status.clock.label : '—'} sub={status.clock ? `${t('Jour')} ${status.clock.day}${cal.holy ? ` · ${t('jour sacré')}` : ''}${cal.market ? ` · ${t('jour du marché')}` : ''}${cal.festival ? ` · ${t('fête de l’hydromel')}` : ''}` : ''} icon={Sparkles} />
        <Stat label={t('Habitants')} value={status.npcs} sub={t('{n} lieux de vie dans la ville', { n: status.spots })} icon={Users} />
        <Stat label={t('Progression du monde')} value={`${status.tier}/7`} sub={t('Réprouvés vaincus')} icon={Drama} />
        <Stat label={t('IA')} value={status.ai.available ? `${status.settings.ai.model}` : t('coupée')} sub={t('{n} réponses · {ms} ms en moyenne · {q} en attente', { n: status.ai.requests, ms: status.ai.requests ? Math.round(status.ai.totalMs / status.ai.requests) : 0, q: status.ai.busy })} icon={Bot} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t('Nouvelles de la ville')} icon={Newspaper}>
          {status.news.length ? (
            <ul className="space-y-2 text-sm">
              {status.news.map((n) => (
                <li key={n.t} className="flex gap-3">
                  <span className="shrink-0 text-xs text-ink-500">{formatDate(n.t)}</span>
                  <span className={cx(n.importance >= 4 ? 'text-ember-300' : 'text-ink-200')}>{n.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('Rien de neuf pour l’instant')} />
          )}
        </Card>
        <Card title={t('Chronique du jour')} icon={ScrollText}>
          <p className="text-sm text-ink-200">{status.chronicle?.text || t('La chronique s’écrit à la fin de chaque journée de jeu.')}</p>
          {status.ai.lastError && <p className="mt-4 text-xs text-blood-400">{t('Dernière erreur IA')} : {status.ai.lastError}</p>}
        </Card>
      </div>
    </div>
  );
}

function Npcs() {
  const t = useT();
  const { data } = useApi('/living/npcs', { interval: 5000 });
  const [open, setOpen] = useState(null);
  if (!data) return <Spinner />;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.npcs.map((npc) => (
          <button key={npc.key} type="button" onClick={() => setOpen(npc.key)} className="rounded-2xl border border-ink-800 bg-ink-900/80 p-4 text-left transition hover:border-ember-500/40">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-ink-100">{npc.name}</div>
                <div className="text-xs text-ink-400">{npc.title}</div>
              </div>
              {npc.absent ? <Badge>{t('absent')}</Badge> : npc.dead ? <Badge tone="red">{t('mort')}</Badge> : <Badge tone={MOOD_TONE[npc.mood.key] || 'neutral'}>{npc.mood.label}</Badge>}
            </div>
            <div className="mt-3 text-xs text-ink-400">
              {t(ACTIVITIES[npc.activity] || npc.activity)}
              {npc.mood.cause ? ` · ${npc.mood.cause}` : ''}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {NEEDS.map(([key]) => (
                <Meter key={key} value={npc.needs[key]} max={1} tone={npc.needs[key] < 0.25 ? 'bg-blood-500' : 'bg-moss-500'} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-500">
              {npc.offers > 0 && <span>{t('{n} contrat(s)', { n: npc.offers })}</span>}
              {npc.shop && <span>{t('boutique')}</span>}
              {npc.relations > 0 && <span>{t('connaît {n} aventurier(s)', { n: npc.relations })}</span>}
            </div>
          </button>
        ))}
      </div>
      {open && <NpcModal npcKey={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function NpcModal({ npcKey, onClose }) {
  const t = useT();
  const can = useCan();
  const { data: npc, reload } = useApi(`/living/npcs/${npcKey}`, { interval: 5000 });
  const [run, busy] = useAction();
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [speech, setSpeech] = useState('');
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    if (npc && !edit) setEdit({ speech: npc.speech, story: npc.story, secret: npc.secret, wants: npc.wants, likes: npc.likes.join(', '), dislikes: npc.dislikes.join(', ') });
  }, [npc, edit]);

  if (!npc) return null;
  const send = () =>
    run('sim', async () => {
      const text = message;
      setMessage('');
      setChat((c) => [...c, { who: t('Toi'), text }]);
      const result = await api(`/living/npcs/${npcKey}/simulate`, { method: 'POST', body: { text } });
      setChat((c) => [...c, ...result.lines.map((l) => ({ who: l.npc, text: l.text }))]);
      reload();
    });

  return (
    <Modal open onClose={onClose} wide title={`${npc.name} — ${npc.title.fr}`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={MOOD_TONE[npc.mood.key] || 'neutral'}>{npc.mood.label}</Badge>
            {npc.mood.cause && <span className="text-ink-400">{npc.mood.cause}</span>}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {EMOTIONS.map(([key, label]) => (
              <div key={key}>
                <div className="flex justify-between text-xs text-ink-400">
                  <span>{t(label)}</span>
                  <span>{Math.round(npc.mind.emotions[key] * 100)}</span>
                </div>
                <Meter value={npc.mind.emotions[key]} max={1} />
              </div>
            ))}
            {NEEDS.map(([key, label]) => (
              <div key={key}>
                <div className="flex justify-between text-xs text-ink-400">
                  <span>{t(label)}</span>
                  <span>{Math.round(npc.mind.needs[key] * 100)}</span>
                </div>
                <Meter value={npc.mind.needs[key]} max={1} tone="bg-moss-500" />
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-500">{t('Souvenirs')}</h3>
            <ul className="max-h-48 space-y-1 overflow-auto text-xs text-ink-300">
              {[...npc.memories].reverse().slice(0, 25).map((m) => (
                <li key={m.t + m.text}>
                  <span className="text-ink-500">{'★'.repeat(m.importance)} </span>
                  {m.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-500">{t('Relations avec les aventuriers')}</h3>
            {npc.relations.length ? (
              <ul className="space-y-1 text-xs text-ink-300">
                {npc.relations.map((r) => (
                  <li key={r.account}>
                    <span className="font-medium text-ink-100">{r.name}</span> · {t('affinité')} {Math.round(r.affinity)} · {r.talks} {t('conversations')}
                    {r.facts.length > 0 && <span className="text-ink-500"> · {r.facts.join(' ; ')}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-500">{t('Personne pour l’instant.')}</p>
            )}
          </div>
          {npc.offers.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-500">{t('Contrats du jour')}</h3>
              <ul className="space-y-1 text-xs text-ink-300">
                {npc.offers.map((o) => (
                  <li key={o.id}>
                    {o.title} · {o.coins} {t('pièces')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-5">
          {can('world.edit') && (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-500">{t('Lui parler (test sans le jeu)')}</h3>
              <div className="mb-2 max-h-56 space-y-1 overflow-auto rounded-lg border border-ink-800 bg-ink-950 p-3 text-sm">
                {chat.length ? chat.map((c, i) => (
                  <div key={i}>
                    <span className="font-medium text-ember-300">{c.who} : </span>
                    <span className="text-ink-200">{c.text}</span>
                  </div>
                )) : <span className="text-xs text-ink-500">{t('Écris comme un joueur dans le chat du jeu.')}</span>}
              </div>
              <div className="flex gap-2">
                <Input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && message.trim() && send()} placeholder={t('Bonjour, tu as du travail ?')} />
                <Button variant="primary" icon={Send} loading={busy === 'sim'} disabled={!message.trim()} onClick={send} />
              </div>
            </div>
          )}
          {can('world.message') && (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-500">{t('Le faire parler en jeu')}</h3>
              <div className="flex gap-2">
                <Input value={speech} onChange={(e) => setSpeech(e.target.value)} placeholder={t('Oyez, oyez !')} />
                <Button
                  icon={Send}
                  loading={busy === 'speak'}
                  disabled={!speech.trim()}
                  onClick={() => run('speak', () => api(`/living/npcs/${npcKey}/speak`, { method: 'POST', body: { text: speech } }).then(() => setSpeech('')), t('Message envoyé'))}
                />
              </div>
            </div>
          )}
          {can('world.edit') && edit && (
            <div className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-ink-500">{t('Personnage')}</h3>
              {[['speech', 'Façon de parler'], ['story', 'Histoire'], ['secret', 'Secret'], ['wants', 'Ce qu’il veut'], ['likes', 'Aime (séparé par des virgules)'], ['dislikes', 'N’aime pas']].map(([key, label]) => (
                <Field key={key} label={t(label)}>
                  <textarea className="h-16 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100" value={edit[key]} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} />
                </Field>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  loading={busy === 'save'}
                  onClick={() =>
                    run('save', () => api(`/living/npcs/${npcKey}`, { method: 'PUT', body: { ...edit, likes: edit.likes.split(',').map((s) => s.trim()), dislikes: edit.dislikes.split(',').map((s) => s.trim()) } }).then(reload), t('Personnage enregistré'))
                  }
                >
                  {t('Enregistrer')}
                </Button>
                <Button variant="danger" loading={busy === 'reset'} onClick={() => run('reset', () => api(`/living/npcs/${npcKey}`, { method: 'PUT', body: { resetMind: true } }).then(reload), t('Mémoire effacée'))}>
                  {t('Effacer souvenirs et relations')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Players() {
  const t = useT();
  const { data } = useApi('/living/players', { interval: 8000 });
  if (!data) return <Spinner />;
  if (!data.players.length) return <Card><Empty icon={UserRound} title={t('Aucun aventurier pour l’instant')}>{t('Les joueurs apparaissent ici dès qu’ils parlent à un habitant ou accomplissent quelque chose.')}</Empty></Card>;
  return (
    <Card padded={false}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-ink-500">
          <tr>
            <th className="px-5 py-3">{t('Aventurier')}</th>
            <th className="px-5 py-3">{t('Titre')}</th>
            <th className="px-5 py-3">{t('Saga')}</th>
            <th className="px-5 py-3">{t('Contrats')}</th>
            <th className="px-5 py-3">{t('Réputation')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">
          {data.players.map((p) => (
            <tr key={p.account}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2 font-medium text-ink-100">
                  {p.name}
                  {p.online && <Badge tone="green">{t('en ligne')}</Badge>}
                  {p.wanted && <Badge tone="red">{t('recherché')}</Badge>}
                </div>
                <div className="text-xs text-ink-500">{formatDate(p.lastSeen)}</div>
              </td>
              <td className="px-5 py-3 text-ink-200">
                {p.title}
                <div className="text-xs text-ink-500">{p.renown} {t('renommée')}</div>
              </td>
              <td className="px-5 py-3 text-xs text-ink-300">
                {p.saga.done} {t('chapitre(s)')}
                {p.saga.chapter && <div className="text-ink-500">{p.saga.chapter} : {p.saga.step}</div>}
              </td>
              <td className="px-5 py-3 text-xs text-ink-300">{t('{a} en cours · {d} accomplis', { a: p.quests, d: p.done })}</td>
              <td className="px-5 py-3 text-xs text-ink-400">{Object.entries(p.reputation).map(([f, v]) => `${f} ${v}`).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Economy() {
  const t = useT();
  const { data } = useApi('/living/economy', { interval: 10000 });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {data.shops.map((shop) => (
        <Card key={shop.key} title={`${shop.owner}`} icon={Coins} actions={<Badge>{t('{n} pièces en caisse', { n: shop.gold })}</Badge>}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-ink-800">
              {shop.goods.map((g) => (
                <tr key={g.item}>
                  <td className="py-1.5 text-ink-200">{g.name}</td>
                  <td className="w-40 py-1.5">
                    <Meter value={g.stock} max={g.target} tone={g.stock < g.target * 0.3 ? 'bg-blood-500' : 'bg-moss-500'} />
                  </td>
                  <td className="w-16 py-1.5 text-right text-xs tabular-nums text-ink-400">{g.stock}/{g.target}</td>
                  <td className="w-20 py-1.5 text-right tabular-nums text-ember-300">{g.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shop.supply.length > 0 && <p className="mt-3 text-xs text-ink-500">{t('Matières livrées')} : {shop.supply.map((s) => `${s.name} ${s.amount}`).join(' · ')}</p>}
          <p className="mt-1 text-xs text-ink-500">{t('Ventes {s} · achats {b}', { s: shop.sold, b: shop.bought })}</p>
        </Card>
      ))}
    </div>
  );
}

function Talks() {
  const t = useT();
  const { data } = useApi('/living/conversations', { interval: 6000 });
  if (!data) return <Spinner />;
  if (!data.conversations.length) return <Card><Empty icon={MessageSquareText} title={t('Aucune conversation encore')} /></Card>;
  return (
    <Card padded={false}>
      <ul className="divide-y divide-ink-800">
        {[...data.conversations].reverse().map((c) => (
          <li key={c.t} className="px-5 py-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              {formatDate(c.t)} · {c.npc} ({c.mood}) {c.ai ? '' : `· ${t('sans IA')}`}
            </div>
            <div>
              <span className="font-medium text-frost-400">{c.player} : </span>
              <span className="text-ink-200">{c.text}</span>
            </div>
            <div>
              <span className="font-medium text-ember-300">{c.npc} : </span>
              <span className="text-ink-200">{c.reply}</span>
            </div>
            {c.facts?.length > 0 && <div className="mt-1 text-xs text-ink-500">{c.facts.join(' · ')}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SettingsTab({ status, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const [form, setForm] = useState(status.settings);
  const [models, setModels] = useState([]);
  const ai = form.ai;
  const setAi = (patch) => setForm({ ...form, ai: { ...ai, ...patch } });
  useEffect(() => {
    if (can('config.edit')) api('/living/ai/models').then((d) => setModels(d.models)).catch(() => {});
  }, [can, status.settings.ai.provider]);
  const save = () => run('save', () => api('/living/settings', { method: 'PUT', body: form }).then(reload), t('Réglages enregistrés'));
  const disabled = !can('config.edit');
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title={t('Vie de la ville')} icon={Sparkles}>
        <div className="space-y-4">
          <Toggle checked={form.enabled} disabled={disabled} onChange={(v) => setForm({ ...form, enabled: v })} label={t('Habitants actifs')} hint={t('Fait apparaître les habitants, leurs routines et leurs dialogues.')} />
          <Toggle checked={form.barks} disabled={disabled} onChange={(v) => setForm({ ...form, barks: v })} label={t('Salutations au passage')} />
          <Toggle checked={form.chatter} disabled={disabled} onChange={(v) => setForm({ ...form, chatter: v })} label={t('Bavardages entre habitants')} />
          <Toggle checked={form.crier} disabled={disabled} onChange={(v) => setForm({ ...form, crier: v })} label={t('Crieur public')} />
          <Toggle checked={form.bard} disabled={disabled} onChange={(v) => setForm({ ...form, bard: v })} label={t('Chansons du barde')} />
          <Toggle checked={form.sermon} disabled={disabled} onChange={(v) => setForm({ ...form, sermon: v })} label={t('Sermon de l’aube')} />
          <Field label={t('Langue des habitants')}>
            <Select value={form.language} disabled={disabled} onChange={(e) => setForm({ ...form, language: e.target.value })} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
          </Field>
          <Field label={t('Retour d’un habitant tué (secondes)')}>
            <Input type="number" value={form.respawnSeconds} disabled={disabled} onChange={(e) => setForm({ ...form, respawnSeconds: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>
      <Card title={t('Intelligence artificielle')} icon={Bot}>
        <div className="space-y-4">
          <Toggle checked={ai.enabled} disabled={disabled} onChange={(v) => setAi({ enabled: v })} label={t('Dialogues par IA')} hint={t('Sans IA, les habitants répondent avec des répliques écrites à l’avance ; quêtes et commerce fonctionnent pareil.')} />
          <Field label={t('Fournisseur')}>
            <Select
              value={ai.provider}
              disabled={disabled}
              onChange={(e) => setAi({ provider: e.target.value, baseUrl: e.target.value === 'ollama' ? 'http://127.0.0.1:11434' : e.target.value === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com' })}
              options={[{ value: 'ollama', label: 'Ollama (local, gratuit)' }, { value: 'openai', label: t('API compatible OpenAI') }, { value: 'anthropic', label: 'Anthropic (Claude)' }]}
            />
          </Field>
          <Field label={t('Adresse')}>
            <Input value={ai.baseUrl} disabled={disabled} onChange={(e) => setAi({ baseUrl: e.target.value })} />
          </Field>
          <Field label={t('Modèle')} hint={models.length ? t('Modèles disponibles : {m}', { m: models.slice(0, 8).join(', ') }) : ''}>
            <Input value={ai.model} disabled={disabled} onChange={(e) => setAi({ model: e.target.value })} />
          </Field>
          {ai.provider !== 'ollama' && (
            <Field label={t('Clé d’API')}>
              <Input type="password" value={ai.apiKey} disabled={disabled} onChange={(e) => setAi({ apiKey: e.target.value })} />
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('Créativité')}>
              <Input type="number" step="0.1" value={ai.temperature} disabled={disabled} onChange={(e) => setAi({ temperature: Number(e.target.value) })} />
            </Field>
            <Field label={t('Délai max (s)')}>
              <Input type="number" value={ai.timeoutSeconds} disabled={disabled} onChange={(e) => setAi({ timeoutSeconds: Number(e.target.value) })} />
            </Field>
            <Field label={t('En parallèle')}>
              <Input type="number" value={ai.concurrency} disabled={disabled} onChange={(e) => setAi({ concurrency: Number(e.target.value) })} />
            </Field>
          </div>
          {!disabled && (
            <Button variant="primary" loading={busy === 'save'} onClick={save}>
              {t('Enregistrer')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
